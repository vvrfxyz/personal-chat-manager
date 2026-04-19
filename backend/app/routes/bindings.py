from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import get_current_account
from ..models import (
    SummaryCursor,
    SummaryReport,
    SummaryRule,
    SummaryRun,
    TelegramAccount,
    TelegramChat,
    UserChatBinding,
)
from ..schemas import BindingOut, BindingPatchIn, RunNowOut, RunOut, ReportOut
from ..security import decrypt
from ..services import summarizer, telegram as tg

logger = logging.getLogger("app.bindings")

router = APIRouter()


def _build_report_out(report: SummaryReport, run: SummaryRun) -> ReportOut:
    return ReportOut.model_validate(report).model_copy(update={
        "covered_from_at": run.covered_from_at,
        "covered_to_at": run.covered_to_at,
    })


async def _binding_for_chat(
    session: AsyncSession, account_id: UUID, chat_id: UUID
) -> tuple[UserChatBinding, SummaryRule, SummaryCursor | None, TelegramChat]:
    chat = await session.get(TelegramChat, chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="chat not found")

    b = (
        await session.execute(
            select(UserChatBinding).where(
                UserChatBinding.telegram_account_id == account_id,
                UserChatBinding.telegram_chat_id == chat_id,
            )
        )
    ).scalar_one_or_none()

    if b is None:
        b = UserChatBinding(
            telegram_account_id=account_id,
            telegram_chat_id=chat_id,
            status="active",
            first_summary_anchor_at=datetime.now(timezone.utc),
        )
        session.add(b)
        await session.flush()

    rule = (
        await session.execute(
            select(SummaryRule).where(SummaryRule.user_chat_binding_id == b.id)
        )
    ).scalar_one_or_none()
    if rule is None:
        rule = SummaryRule(user_chat_binding_id=b.id)
        session.add(rule)
        await session.flush()

    cursor = (
        await session.execute(
            select(SummaryCursor).where(SummaryCursor.user_chat_binding_id == b.id)
        )
    ).scalar_one_or_none()

    return b, rule, cursor, chat


def _as_out(b: UserChatBinding, rule: SummaryRule, cursor: SummaryCursor | None) -> BindingOut:
    return BindingOut(
        id=b.id,
        telegram_chat_id=b.telegram_chat_id,
        status=b.status,
        auto_summary_enabled=b.auto_summary_enabled,
        first_summary_mode=b.first_summary_mode,
        first_summary_anchor_at=b.first_summary_anchor_at,
        last_run_at=b.last_run_at,
        last_success_at=b.last_success_at,
        last_error_at=b.last_error_at,
        last_error_message=b.last_error_message,
        pinned_at=b.pinned_at,
        frequency=rule.frequency,
        preferred_language=rule.preferred_language,
        template_key=rule.template_key,
        cursor_message_id=(cursor.last_message_id if cursor else None),
        cursor_at=(cursor.last_message_at if cursor else None),
    )


@router.get("/{chat_id}", response_model=BindingOut)
async def get_binding(
    chat_id: UUID,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> BindingOut:
    b, rule, cursor, _ = await _binding_for_chat(session, account.id, chat_id)
    await session.commit()
    return _as_out(b, rule, cursor)


@router.patch("/{chat_id}", response_model=BindingOut)
async def update_binding(
    chat_id: UUID,
    patch: BindingPatchIn,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> BindingOut:
    b, rule, cursor, _ = await _binding_for_chat(session, account.id, chat_id)

    if patch.auto_summary_enabled is not None:
        b.auto_summary_enabled = patch.auto_summary_enabled
    if patch.pinned is not None:
        b.pinned_at = datetime.now(timezone.utc) if patch.pinned else None
    if patch.first_summary_mode is not None:
        b.first_summary_mode = patch.first_summary_mode
        now = datetime.now(timezone.utc)
        if patch.first_summary_mode == "from_now":
            b.first_summary_anchor_at = now
        elif patch.first_summary_mode == "last_24h":
            b.first_summary_anchor_at = now - timedelta(hours=24)
        elif patch.first_summary_mode == "last_7d":
            b.first_summary_anchor_at = now - timedelta(days=7)

    if patch.frequency is not None:
        rule.frequency = patch.frequency
        now = datetime.now(timezone.utc)
        delta = summarizer.frequency_delta(rule.frequency)
        rule.next_run_at = (now + delta) if delta is not None else None
    if patch.preferred_language is not None:
        rule.preferred_language = patch.preferred_language
    if patch.template_key is not None:
        rule.template_key = patch.template_key

    b.updated_at = datetime.now(timezone.utc)
    rule.updated_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(b)
    await session.refresh(rule)
    return _as_out(b, rule, cursor)


@router.post("/{chat_id}/run", response_model=RunNowOut)
async def run_now(
    chat_id: UUID,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> RunNowOut:
    b, _, _, chat = await _binding_for_chat(session, account.id, chat_id)
    if not chat.is_active:
        raise HTTPException(
            status_code=409,
            detail="chat is no longer accessible (user left or it was removed); sync again",
        )
    await session.commit()
    try:
        run, report = await summarizer.execute_run(
            session=session, binding_id=str(b.id), trigger_source="manual"
        )
    except summarizer.RunInProgressError:
        raise HTTPException(status_code=409, detail="另一份报告正在生成中，请稍候")
    return RunNowOut(
        run=RunOut.model_validate(run),
        report=_build_report_out(report, run) if report else None,
    )


@router.get("/{chat_id}/runs", response_model=list[RunOut])
async def list_chat_runs(
    chat_id: UUID,
    limit: int = 30,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> list[RunOut]:
    from ..models import SummaryRun as _SR

    stmt = (
        select(_SR)
        .join(UserChatBinding, UserChatBinding.id == _SR.user_chat_binding_id)
        .where(
            UserChatBinding.telegram_chat_id == chat_id,
            UserChatBinding.telegram_account_id == account.id,
        )
        .order_by(_SR.created_at.desc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).scalars().all()
    return [RunOut.model_validate(r) for r in rows]


class BindingPreviewOut(BaseModel):
    pending_count: int           # messages with non-empty text (what summarizer picks up)
    pending_total: int           # all messages in window, including media-only / service
    pending_capped: bool = False # true when the scan hit the cap and more may exist
    cursor_message_id: int | None
    cursor_at: datetime | None
    last_run_at: datetime | None
    last_success_at: datetime | None
    last_error_at: datetime | None
    last_error_message: str | None
    next_run_at: datetime | None


# Cap how many raw messages we'll scan when computing the preview count.
# The summary engine itself is bounded by `rule.max_messages_per_run` (500
# by default), so anything past this would not be summarized in one run anyway.
_PREVIEW_SCAN_CAP = 500


@router.get("/{chat_id}/preview", response_model=BindingPreviewOut)
async def preview_binding(
    chat_id: UUID,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> BindingPreviewOut:
    """Count messages waiting past the cursor.

    `pending_count` matches `_fetch_messages` filtering (text-bearing only) —
    that is what the next summary run will actually consume. `pending_total`
    is the raw count including stickers, media-only, and service messages so
    the UI can show why the summarizable count looks smaller than what users
    see scrolling Telegram.
    """
    b, rule, cursor, chat = await _binding_for_chat(session, account.id, chat_id)
    await session.commit()

    pending_text = 0
    pending_total = 0
    pending_capped = False
    if chat.is_active:
        try:
            session_string = decrypt(account.session_encrypted)
            min_id = cursor.last_message_id if cursor and cursor.last_message_id else 0
            offset_date = None if min_id else b.first_summary_anchor_at
            async with tg.build_client(session_string) as client:
                peer = summarizer._resolve_peer(
                    chat.external_chat_id, chat.chat_type, chat.access_hash, chat.username
                )
                kwargs: dict = {"reverse": True, "limit": _PREVIEW_SCAN_CAP}
                if min_id:
                    kwargs["min_id"] = min_id
                if offset_date is not None:
                    kwargs["offset_date"] = offset_date
                async for msg in client.iter_messages(peer, **kwargs):
                    pending_total += 1
                    if (msg.message or "").strip():
                        pending_text += 1
                pending_capped = pending_total >= _PREVIEW_SCAN_CAP
        except Exception as exc:  # noqa: BLE001
            logger.warning("preview: count failed for %s: %s", chat.id, exc)

    return BindingPreviewOut(
        pending_count=pending_text,
        pending_total=pending_total,
        pending_capped=pending_capped,
        cursor_message_id=cursor.last_message_id if cursor else None,
        cursor_at=cursor.last_message_at if cursor else None,
        last_run_at=b.last_run_at,
        last_success_at=b.last_success_at,
        last_error_at=b.last_error_at,
        last_error_message=b.last_error_message,
        next_run_at=rule.next_run_at if rule else None,
    )


class RunRangeIn(BaseModel):
    from_at: datetime = Field(..., description="inclusive lower time bound (UTC)")
    to_at: datetime | None = Field(default=None, description="inclusive upper bound; null = now")
    limit: int = Field(default=500, ge=1, le=2000)


@router.post("/{chat_id}/run-range", response_model=RunNowOut)
async def run_range(
    chat_id: UUID,
    payload: RunRangeIn,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> RunNowOut:
    """One-off summary over an explicit time window. Does NOT touch the cursor."""
    b, _, _, chat = await _binding_for_chat(session, account.id, chat_id)
    if not chat.is_active:
        raise HTTPException(
            status_code=409,
            detail="chat is no longer accessible; sync again",
        )
    if payload.to_at and payload.to_at <= payload.from_at:
        raise HTTPException(status_code=400, detail="to_at must be after from_at")

    await session.commit()
    spec = summarizer.FetchSpec(
        after_dt=payload.from_at,
        before_dt=payload.to_at,
        limit=payload.limit,
        advance_cursor=False,
    )
    logger.info(
        "run_range binding=%s from=%s to=%s",
        b.id, payload.from_at.isoformat(), payload.to_at.isoformat() if payload.to_at else "now",
    )
    try:
        run, report = await summarizer.execute_run(
            session=session,
            binding_id=str(b.id),
            trigger_source="manual:range",
            fetch_spec=spec,
        )
    except summarizer.RunInProgressError:
        raise HTTPException(status_code=409, detail="另一份报告正在生成中，请稍候")
    return RunNowOut(
        run=RunOut.model_validate(run),
        report=_build_report_out(report, run) if report else None,
    )
