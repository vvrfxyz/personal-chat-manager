# Personal Chat Manager · Backend

Phase 1 MVP backend. Single-user, single Telegram account. Python 3.11+ / FastAPI / SQLAlchemy 2 async / Telethon / APScheduler / OpenAI SDK.

## Setup

Postgres + Redis are assumed running in OrbStack (container `postgres`, DB `personal_chat_manager`).

```bash
cd backend
uv sync
cp .env.example .env   # edit ENCRYPTION_KEY and OPENAI_API_KEY
psql "postgresql://postgres:wenruifeng@127.0.0.1:5432/personal_chat_manager" -f schema.sql
```

## Run

```bash
uv run uvicorn app.main:app --reload --port 8787
# docs: http://127.0.0.1:8787/docs
```

## API surface

Auth (MTProto user login):

- `POST /api/auth/telegram/send-code` → `{login_id, phone, expires_at}`
- `POST /api/auth/telegram/verify {login_id, code, password?}` → account; returns `409 password_required` if 2FA needed
- `GET /api/auth/me` — current bound account (or `null`)
- `POST /api/auth/logout` — mark disconnected

Chats:

- `GET /api/chats` — list synced chats with per-chat binding
- `POST /api/chats/sync` — pull dialogs from Telegram, upsert into `telegram_chats`

Bindings & configuration:

- `GET /api/bindings/{chat_id}` — auto-creates binding + rule if missing
- `PATCH /api/bindings/{chat_id}` — body may set `auto_summary_enabled`, `frequency`, `preferred_language`, `template_key`, `first_summary_mode`
- `POST /api/bindings/{chat_id}/run` — trigger a summary immediately

Reports:

- `GET /api/reports?chat_id=&limit=&offset=`
- `GET /api/reports/{report_id}`
- `GET /api/reports/runs/recent`
- `GET /api/reports/unread-counts` → `[{chat_id, count}]` for unread badges
- `POST /api/reports/mark-all-read?chat_id=` (chat_id optional; account-wide if omitted) → `{updated}`
- `POST /api/reports/{report_id}/read` → 204, idempotent
- `POST /api/reports/{report_id}/unread` → 204

Admin / inspector:

- `GET /api/admin/health`
- `GET /api/admin/db` — JSON snapshot of all tables (session_encrypted redacted)

## Scheduler

`APScheduler` runs inside the uvicorn process (configurable with `SCHEDULER_ENABLED`). Every minute it checks `summary_rules.next_run_at`; when a due binding with `auto_summary_enabled=true` is found it calls the same `execute_run` path as manual run-now.

## Security

- Telegram session strings (and in-flight login sessions) encrypted with Fernet. Key is in `ENCRYPTION_KEY` — rotating the key invalidates bound accounts.
- `admin/db` redacts `session_encrypted`.
