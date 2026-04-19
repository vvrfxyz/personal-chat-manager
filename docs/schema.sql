-- Personal Chat Manager MVP schema draft
-- Target: PostgreSQL

create extension if not exists "pgcrypto";

create type user_role as enum ('user', 'admin');
create type telegram_account_status as enum ('pending', 'active', 'reauth_required', 'disconnected', 'disabled');
create type chat_type as enum ('private', 'group', 'supergroup', 'channel');
create type binding_status as enum ('active', 'paused', 'reauth_required', 'archived');
create type summary_frequency as enum ('manual', 'hourly', 'daily');
create type summary_run_status as enum ('pending', 'running', 'success', 'failed', 'skipped', 'cancelled');

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  display_name text,
  role user_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table telegram_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
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
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index telegram_accounts_status_idx on telegram_accounts(status);
create index telegram_accounts_telegram_user_id_idx on telegram_accounts(telegram_user_id);

create table telegram_chats (
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

create index telegram_chats_chat_type_idx on telegram_chats(chat_type);
create index telegram_chats_title_idx on telegram_chats(title);

create table user_chat_bindings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  telegram_account_id uuid not null references telegram_accounts(id),
  telegram_chat_id uuid not null references telegram_chats(id),
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

create index user_chat_bindings_user_id_idx on user_chat_bindings(user_id);
create index user_chat_bindings_chat_id_idx on user_chat_bindings(telegram_chat_id);
create index user_chat_bindings_enabled_idx on user_chat_bindings(auto_summary_enabled);
create index user_chat_bindings_status_idx on user_chat_bindings(status);

create table summary_rules (
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

create index summary_rules_frequency_idx on summary_rules(frequency);
create index summary_rules_next_run_at_idx on summary_rules(next_run_at);

create table summary_cursors (
  id uuid primary key default gen_random_uuid(),
  user_chat_binding_id uuid not null unique references user_chat_bindings(id) on delete cascade,
  last_message_id bigint,
  last_message_at timestamptz,
  last_message_grouped_id bigint,
  cursor_metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table summary_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  telegram_account_id uuid not null references telegram_accounts(id),
  telegram_chat_id uuid not null references telegram_chats(id),
  user_chat_binding_id uuid not null references user_chat_bindings(id),
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

create index summary_runs_binding_id_idx on summary_runs(user_chat_binding_id);
create index summary_runs_status_idx on summary_runs(status);
create index summary_runs_created_at_idx on summary_runs(created_at desc);

create table summary_reports (
  id uuid primary key default gen_random_uuid(),
  summary_run_id uuid not null unique references summary_runs(id) on delete cascade,
  user_chat_binding_id uuid not null references user_chat_bindings(id),
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
  created_at timestamptz not null default now()
);

create index summary_reports_binding_id_idx on summary_reports(user_chat_binding_id);
create index summary_reports_generated_at_idx on summary_reports(generated_at desc);

create table admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id),
  action text not null,
  target_type text not null,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_logs_actor_idx on admin_audit_logs(actor_user_id);
create index admin_audit_logs_created_at_idx on admin_audit_logs(created_at desc);

-- Optional future table:
-- A raw message cache can be added later if operationally necessary,
-- but it is intentionally excluded from MVP to reduce privacy risk.
