from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import (
    SummaryCursor,
    SummaryReport,
    SummaryRule,
    SummaryRun,
    TelegramAccount,
    TelegramChat,
    UserChatBinding,
)

router = APIRouter()


def _redact_account(a: TelegramAccount) -> dict[str, Any]:
    return {
        "id": str(a.id),
        "telegram_user_id": "<redacted>",
        "phone_e164": "<redacted>",
        "account_display_name": "<redacted>",
        "account_username": "<redacted>",
        "session_encrypted": "<redacted>",
        "status": a.status,
        "last_synced_at": a.last_synced_at,
        "last_validated_at": a.last_validated_at,
        "created_at": a.created_at,
        "updated_at": a.updated_at,
    }


def _row(obj: Any, extra_redact: set[str] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for col in obj.__table__.columns.keys():  # noqa: SIM118
        val = getattr(obj, col)
        if extra_redact and col in extra_redact:
            out[col] = "<redacted>"
        else:
            out[col] = val
    return out


@router.get("/db")
async def db_snapshot(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    accounts = (await session.execute(select(TelegramAccount))).scalars().all()
    chats = (await session.execute(select(TelegramChat))).scalars().all()
    bindings = (await session.execute(select(UserChatBinding))).scalars().all()
    rules = (await session.execute(select(SummaryRule))).scalars().all()
    cursors = (await session.execute(select(SummaryCursor))).scalars().all()
    runs = (
        await session.execute(
            select(SummaryRun).order_by(SummaryRun.created_at.desc()).limit(50)
        )
    ).scalars().all()
    reports = (
        await session.execute(
            select(SummaryReport).order_by(SummaryReport.generated_at.desc()).limit(50)
        )
    ).scalars().all()

    return {
        "telegram_accounts": [_redact_account(a) for a in accounts],
        "telegram_chats": [_row(c) for c in chats],
        "user_chat_bindings": [_row(b) for b in bindings],
        "summary_rules": [_row(r) for r in rules],
        "summary_cursors": [_row(c) for c in cursors],
        "summary_runs": [_row(r) for r in runs],
        "summary_reports": [_row(r) for r in reports],
    }


@router.get("/health")
async def admin_health(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for cls, key in (
        (TelegramAccount, "accounts"),
        (TelegramChat, "chats"),
        (UserChatBinding, "bindings"),
        (SummaryRun, "runs"),
        (SummaryReport, "reports"),
    ):
        result = await session.execute(select(cls))
        counts[key] = len(result.scalars().all())
    return {"status": "ok", "counts": counts}
