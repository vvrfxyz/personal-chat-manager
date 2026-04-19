-- Personal Chat Manager — Phase 1 MVP schema (single-user)
-- Target: PostgreSQL 17
-- Changes vs docs/schema.sql:
--   * Drops `users` table (single-user mode; Telegram account is identity)
--   * Removes user_id FK columns from dependent tables
--   * Keeps binding/run/report structure intact

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- enums ---------------------------------------------------------------
do $$ begin
  create type telegram_account_status as enum ('pending', 'active', 'reauth_required', 'disconnected', 'disabled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type chat_type as enum ('private', 'group', 'supergroup', 'channel');
exception when duplicate_object then null; end $$;

do $$ begin
  create type binding_status as enum ('active', 'paused', 'reauth_required', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type summary_frequency as enum ('manual', 'hourly', 'every_6h', 'every_12h', 'daily');
exception when duplicate_object then null; end $$;

-- Idempotent enum extension for already-existing databases
do $$ begin
  alter type summary_frequency add value if not exists 'every_6h';
  alter type summary_frequency add value if not exists 'every_12h';
exception when undefined_object then null; end $$;

do $$ begin
  create type summary_run_status as enum ('pending', 'running', 'success', 'failed', 'skipped', 'cancelled');
exception when duplicate_object then null; end $$;

-- tables --------------------------------------------------------------

create table if not exists telegram_accounts (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint,
  phone_e164 text,
  account_display_name text,
  account_username text,
  session_encrypted text not null,
  status telegram_account_status not null default 'pending',
  last_synced_at timestamptz,
  last_validated_at timestamptz,
  reauth_required_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_accounts_status_idx on telegram_accounts(status);
create index if not exists telegram_accounts_telegram_user_id_idx on telegram_accounts(telegram_user_id);

create table if not exists telegram_chats (
  id uuid primary key default gen_random_uuid(),
  external_chat_id bigint not null unique,
  access_hash text,
  title text not null,
  username text,
  chat_type chat_type not null,
  avatar_url text,
  description text,
  member_count integer,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_synced_at timestamptz,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists telegram_chats_chat_type_idx on telegram_chats(chat_type);
create index if not exists telegram_chats_title_idx on telegram_chats(title);

create table if not exists user_chat_bindings (
  id uuid primary key default gen_random_uuid(),
  telegram_account_id uuid not null references telegram_accounts(id) on delete cascade,
  telegram_chat_id uuid not null references telegram_chats(id) on delete cascade,
  status binding_status not null default 'active',
  auto_summary_enabled boolean not null default false,
  first_summary_mode text not null default 'from_now',
  first_summary_anchor_at timestamptz,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_account_id, telegram_chat_id)
);

create index if not exists user_chat_bindings_chat_id_idx on user_chat_bindings(telegram_chat_id);
create index if not exists user_chat_bindings_enabled_idx on user_chat_bindings(auto_summary_enabled);
create index if not exists user_chat_bindings_status_idx on user_chat_bindings(status);

-- Pin-to-top: null = not pinned; non-null = pinned at time T (newer pin → higher rank)
alter table user_chat_bindings add column if not exists pinned_at timestamptz;
create index if not exists user_chat_bindings_pinned_at_idx on user_chat_bindings(pinned_at);

create table if not exists summary_rules (
  id uuid primary key default gen_random_uuid(),
  user_chat_binding_id uuid not null unique references user_chat_bindings(id) on delete cascade,
  frequency summary_frequency not null default 'manual',
  preferred_language text not null default 'zh-CN',
  template_key text not null default 'default',
  custom_prompt text,
  min_message_count integer not null default 1,
  max_messages_per_run integer not null default 500,
  only_run_when_new_messages boolean not null default true,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists summary_rules_frequency_idx on summary_rules(frequency);
create index if not exists summary_rules_next_run_at_idx on summary_rules(next_run_at);

create table if not exists summary_cursors (
  id uuid primary key default gen_random_uuid(),
  user_chat_binding_id uuid not null unique references user_chat_bindings(id) on delete cascade,
  last_message_id bigint,
  last_message_at timestamptz,
  last_message_grouped_id bigint,
  cursor_metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists summary_runs (
  id uuid primary key default gen_random_uuid(),
  telegram_account_id uuid not null references telegram_accounts(id) on delete cascade,
  telegram_chat_id uuid not null references telegram_chats(id) on delete cascade,
  user_chat_binding_id uuid not null references user_chat_bindings(id) on delete cascade,
  status summary_run_status not null default 'pending',
  trigger_source text not null default 'scheduler',
  started_at timestamptz,
  finished_at timestamptz,
  covered_from_message_id bigint,
  covered_to_message_id bigint,
  covered_from_at timestamptz,
  covered_to_at timestamptz,
  fetched_message_count integer not null default 0,
  input_token_count integer,
  output_token_count integer,
  model_name text,
  retry_count integer not null default 0,
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists summary_runs_binding_id_idx on summary_runs(user_chat_binding_id);
create index if not exists summary_runs_status_idx on summary_runs(status);
create index if not exists summary_runs_created_at_idx on summary_runs(created_at desc);

create table if not exists summary_reports (
  id uuid primary key default gen_random_uuid(),
  summary_run_id uuid not null unique references summary_runs(id) on delete cascade,
  user_chat_binding_id uuid not null references user_chat_bindings(id) on delete cascade,
  title text not null,
  executive_summary text,
  key_points jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,
  action_items jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  mentions jsonb not null default '[]'::jsonb,
  links jsonb not null default '[]'::jsonb,
  content_markdown text not null,
  language text not null default 'zh-CN',
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists summary_reports_binding_id_idx on summary_reports(user_chat_binding_id);
create index if not exists summary_reports_generated_at_idx on summary_reports(generated_at desc);

-- in-progress Telegram auth state (phone_code_hash cache) --------------
create table if not exists telegram_login_sessions (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  phone_code_hash text not null,
  session_encrypted text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

create index if not exists telegram_login_sessions_phone_idx on telegram_login_sessions(phone_e164);
create index if not exists telegram_login_sessions_expires_idx on telegram_login_sessions(expires_at);

-- raw messages for cross-window reply chain lookups + full-text search
create table if not exists telegram_messages (
  telegram_chat_id uuid not null references telegram_chats(id) on delete cascade,
  external_msg_id bigint not null,
  date timestamptz not null,
  sender_id bigint,
  sender_name text,
  reply_to_msg_id bigint,
  text text,
  raw_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (telegram_chat_id, external_msg_id)
);

create index if not exists telegram_messages_reply_idx
  on telegram_messages(telegram_chat_id, reply_to_msg_id)
  where reply_to_msg_id is not null;

create index if not exists telegram_messages_date_idx
  on telegram_messages(telegram_chat_id, date desc);

create index if not exists telegram_messages_text_trgm_idx
  on telegram_messages using gin (text gin_trgm_ops);
