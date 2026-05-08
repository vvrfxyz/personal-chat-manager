from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
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


def _cursor_meta(cursor: SummaryCursor | None) -> dict[str, Any]:
    if cursor is None:
        return {}
    return dict(cursor.cursor_metadata or {})


def _catch_up_meta(cursor: SummaryCursor | None) -> dict[str, Any]:
    meta = _cursor_meta(cursor).get("catch_up")
    return dict(meta) if isinstance(meta, dict) else {}


def _catch_up_int(meta: dict[str, Any], key: str, default: int = 0) -> int:
    try:
        return int(meta.get(key) or default)
    except (TypeError, ValueError):
        return default


def _set_catch_up_meta(cursor: SummaryCursor, patch: dict[str, Any] | None) -> None:
    meta = _cursor_meta(cursor)
    if patch is None:
        meta.pop("catch_up", None)
    else:
        meta["catch_up"] = patch
    cursor.cursor_metadata = meta


def _meta_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _normal_next_run(rule: SummaryRule, enabled: bool, now: datetime) -> datetime | None:
    if not enabled or rule.frequency == "manual":
        return None
    delta = summarizer.frequency_delta(rule.frequency)
    return (now + delta) if delta is not None else None


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
    pending_count: int | None    # text-bearing messages in the next scan window
    pending_total: int | None    # all messages in the next scan window, including media-only / service
    pending_capped: bool = False # true when more raw messages may exist beyond the scan window
    pending_id_span: int | None = None
    estimated_batches: int | None = None
    scan_cap: int = 500
    latest_message_id: int | None = None
    latest_message_at: datetime | None = None
    catch_up_active: bool = False
    catch_up_started_at: datetime | None = None
    catch_up_last_batch_at: datetime | None = None
    catch_up_batches_completed: int = 0
    catch_up_failed_batches: int = 0
    catch_up_reports_generated: int = 0
    catch_up_tokens_used: int = 0
    catch_up_batch_size: int = 500
    catch_up_cadence: str = "every_2m"
    catch_up_result_type: str = "archive_reports"
    catch_up_failure_policy: str = "pause"
    catch_up_max_batches: int | None = None
    catch_up_max_tokens: int | None = None
    catch_up_max_reports: int | None = None
    catch_up_stop_reason: str | None = None
    catch_up_last_error_message: str | None = None
    count_error: str | None = None
    cursor_message_id: int | None
    cursor_at: datetime | None
    last_run_at: datetime | None
    last_success_at: datetime | None
    last_error_at: datetime | None
    last_error_message: str | None
    next_run_at: datetime | None


@router.get("/{chat_id}/preview", response_model=BindingPreviewOut)
async def preview_binding(
    chat_id: UUID,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> BindingPreviewOut:
    """Count messages waiting past the cursor.

    `pending_count` matches the bounded next-run scan window, so the UI shows
    the exact number of text-bearing messages the next summary run can consume.
    The scan is intentionally capped at `rule.max_messages_per_run` to avoid
    Telegram flood-wait penalties on large backlogs.
    """
    b, rule, cursor, chat = await _binding_for_chat(session, account.id, chat_id)
    await session.commit()

    pending_text: int | None = 0
    pending_total: int | None = 0
    pending_id_span: int | None = None
    estimated_batches: int | None = None
    latest_message_id: int | None = None
    latest_message_at: datetime | None = None
    pending_capped = False
    count_error: str | None = None
    catch_up = _catch_up_meta(cursor)
    catch_up_active = bool(catch_up.get("active"))
    catch_up_batch_size = _catch_up_int(catch_up, "batch_size", 500)
    if catch_up_batch_size not in {500, 1000, 2000}:
        catch_up_batch_size = 500
    catch_up_cadence = str(catch_up.get("cadence") or "every_2m")
    catch_up_result_type = str(catch_up.get("result_type") or "archive_reports")
    catch_up_failure_policy = str(catch_up.get("failure_policy") or "pause")
    scan_cap = catch_up_batch_size if catch_up_active else (rule.max_messages_per_run if rule else 500)
    catch_up_started_at = _meta_datetime(catch_up.get("started_at"))
    catch_up_last_batch_at = _meta_datetime(catch_up.get("last_batch_at"))
    catch_up_batches_completed = _catch_up_int(catch_up, "batches_completed")
    catch_up_failed_batches = _catch_up_int(catch_up, "failed_batches")
    catch_up_reports_generated = _catch_up_int(catch_up, "reports_generated")
    catch_up_tokens_used = _catch_up_int(catch_up, "tokens_used")
    if chat.is_active:
        try:
            session_string = decrypt(account.session_encrypted)
            min_id = cursor.last_message_id if cursor and cursor.last_message_id else 0
            offset_date = None if min_id else b.first_summary_anchor_at
            async with tg.build_client(session_string) as client:
                peer = summarizer._resolve_peer(
                    chat.external_chat_id, chat.chat_type, chat.access_hash, chat.username
                )
                latest = await client.get_messages(peer, limit=1)
                if latest:
                    latest_msg = latest[0]
                    latest_message_id = int(latest_msg.id)
                    latest_message_at = latest_msg.date
                    if min_id:
                        pending_id_span = max(latest_message_id - int(min_id), 0)
                        if pending_id_span:
                            estimated_batches = max(1, math.ceil(pending_id_span / max(scan_cap, 1)))
                kwargs: dict = {"reverse": True, "limit": scan_cap}
                if min_id:
                    kwargs["min_id"] = min_id
                if offset_date is not None:
                    kwargs["offset_date"] = offset_date
                async for msg in client.iter_messages(peer, **kwargs):
                    pending_total += 1
                    if (msg.message or "").strip():
                        pending_text += 1
                pending_capped = pending_total >= scan_cap
        except Exception as exc:  # noqa: BLE001
            logger.warning("preview: count failed for %s: %s", chat.id, exc)
            pending_text = None
            pending_total = None
            pending_id_span = None
            estimated_batches = None
            latest_message_id = None
            latest_message_at = None
            count_error = str(exc)[:300]

    return BindingPreviewOut(
        pending_count=pending_text,
        pending_total=pending_total,
        pending_capped=pending_capped,
        pending_id_span=pending_id_span,
        estimated_batches=estimated_batches,
        scan_cap=scan_cap,
        latest_message_id=latest_message_id,
        latest_message_at=latest_message_at,
        catch_up_active=catch_up_active,
        catch_up_started_at=catch_up_started_at,
        catch_up_last_batch_at=catch_up_last_batch_at,
        catch_up_batches_completed=catch_up_batches_completed,
        catch_up_failed_batches=catch_up_failed_batches,
        catch_up_reports_generated=catch_up_reports_generated,
        catch_up_tokens_used=catch_up_tokens_used,
        catch_up_batch_size=catch_up_batch_size,
        catch_up_cadence=catch_up_cadence,
        catch_up_result_type=catch_up_result_type,
        catch_up_failure_policy=catch_up_failure_policy,
        catch_up_max_batches=catch_up.get("max_batches"),
        catch_up_max_tokens=catch_up.get("max_tokens"),
        catch_up_max_reports=catch_up.get("max_reports"),
        catch_up_stop_reason=catch_up.get("stop_reason"),
        catch_up_last_error_message=catch_up.get("last_error_message"),
        count_error=count_error,
        cursor_message_id=cursor.last_message_id if cursor else None,
        cursor_at=cursor.last_message_at if cursor else None,
        last_run_at=b.last_run_at,
        last_success_at=b.last_success_at,
        last_error_at=b.last_error_at,
        last_error_message=b.last_error_message,
        next_run_at=rule.next_run_at if rule else None,
    )


class BindingActionOut(BaseModel):
    status: str
    next_run_at: datetime | None
    cursor_message_id: int | None
    cursor_at: datetime | None


class CatchUpStartIn(BaseModel):
    batch_size: Literal[500, 1000, 2000] = 500
    cadence: Literal["continuous", "every_2m", "slow_background"] = "every_2m"
    max_batches: int | None = Field(default=None, ge=1, le=1000)
    max_tokens: int | None = Field(default=None, ge=1000, le=50_000_000)
    max_reports: int | None = Field(default=None, ge=1, le=1000)
    result_type: Literal["archive_reports", "daily_digest", "latest_summary"] = "archive_reports"
    failure_policy: Literal["pause", "retry_once", "skip_batch"] = "pause"


@router.post("/{chat_id}/catch-up/start", response_model=BindingActionOut)
async def start_catch_up(
    chat_id: UUID,
    payload: CatchUpStartIn | None = None,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> BindingActionOut:
    payload = payload or CatchUpStartIn()
    b, rule, cursor, chat = await _binding_for_chat(session, account.id, chat_id)
    if not chat.is_active:
        raise HTTPException(status_code=409, detail="chat is no longer accessible; sync again")

    now = datetime.now(timezone.utc)
    if cursor is None:
        cursor = SummaryCursor(user_chat_binding_id=b.id, cursor_metadata={})
        session.add(cursor)
        await session.flush()

    if payload.result_type == "latest_summary":
        try:
            session_string = decrypt(account.session_encrypted)
            async with tg.build_client(session_string) as client:
                peer = summarizer._resolve_peer(
                    chat.external_chat_id, chat.chat_type, chat.access_hash, chat.username
                )
                latest_batch = await client.get_messages(peer, limit=payload.batch_size)
        except Exception as exc:  # noqa: BLE001
            logger.warning("catch_up latest window failed for %s: %s", chat.id, exc)
            raise HTTPException(status_code=502, detail=f"读取最近消息失败：{str(exc)[:160]}") from exc
        if not latest_batch:
            raise HTTPException(status_code=409, detail="这个聊天还没有可处理的最近消息")
        oldest = latest_batch[-1]
        cursor.last_message_id = max(int(oldest.id) - 1, 1)
        cursor.last_message_at = oldest.date

    _set_catch_up_meta(cursor, {
        "active": True,
        "started_at": now.isoformat(),
        "batch_size": payload.batch_size,
        "cadence": payload.cadence,
        "max_batches": payload.max_batches,
        "max_tokens": payload.max_tokens,
        "max_reports": 1 if payload.result_type == "latest_summary" else payload.max_reports,
        "result_type": payload.result_type,
        "failure_policy": payload.failure_policy,
        "batches_completed": 0,
        "failed_batches": 0,
        "reports_generated": 0,
        "tokens_used": 0,
        "stop_reason": None,
        "last_error_message": None,
        "daily_parts": [],
    })
    rule.next_run_at = now
    rule.updated_at = now
    b.updated_at = now
    await session.commit()
    return BindingActionOut(
        status="catching_up",
        next_run_at=rule.next_run_at,
        cursor_message_id=cursor.last_message_id,
        cursor_at=cursor.last_message_at,
    )


@router.post("/{chat_id}/catch-up/stop", response_model=BindingActionOut)
async def stop_catch_up(
    chat_id: UUID,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> BindingActionOut:
    b, rule, cursor, _ = await _binding_for_chat(session, account.id, chat_id)
    now = datetime.now(timezone.utc)
    if cursor is not None:
        catch_up = _catch_up_meta(cursor)
        catch_up["active"] = False
        catch_up["stopped_at"] = now.isoformat()
        _set_catch_up_meta(cursor, catch_up)
    rule.next_run_at = _normal_next_run(rule, b.auto_summary_enabled, now)
    rule.updated_at = now
    b.updated_at = now
    await session.commit()
    return BindingActionOut(
        status="stopped",
        next_run_at=rule.next_run_at,
        cursor_message_id=cursor.last_message_id if cursor else None,
        cursor_at=cursor.last_message_at if cursor else None,
    )


@router.post("/{chat_id}/skip-backlog", response_model=BindingActionOut)
async def skip_backlog(
    chat_id: UUID,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> BindingActionOut:
    b, rule, cursor, chat = await _binding_for_chat(session, account.id, chat_id)
    if not chat.is_active:
        raise HTTPException(status_code=409, detail="chat is no longer accessible; sync again")

    now = datetime.now(timezone.utc)
    try:
        session_string = decrypt(account.session_encrypted)
        async with tg.build_client(session_string) as client:
            peer = summarizer._resolve_peer(
                chat.external_chat_id, chat.chat_type, chat.access_hash, chat.username
            )
            latest = await client.get_messages(peer, limit=1)
    except Exception as exc:  # noqa: BLE001
        logger.warning("skip_backlog: latest lookup failed for %s: %s", chat.id, exc)
        raise HTTPException(status_code=502, detail=f"读取最新消息失败：{str(exc)[:160]}") from exc

    if not latest:
        raise HTTPException(status_code=409, detail="这个聊天还没有可定位的最新消息")

    latest_msg = latest[0]
    if cursor is None:
        cursor = SummaryCursor(user_chat_binding_id=b.id, cursor_metadata={})
        session.add(cursor)
        await session.flush()
    cursor.last_message_id = int(latest_msg.id)
    cursor.last_message_at = latest_msg.date
    _set_catch_up_meta(cursor, None)

    b.first_summary_anchor_at = now
    b.updated_at = now
    rule.next_run_at = _normal_next_run(rule, b.auto_summary_enabled, now)
    rule.updated_at = now
    await session.commit()
    return BindingActionOut(
        status="skipped_to_latest",
        next_run_at=rule.next_run_at,
        cursor_message_id=cursor.last_message_id,
        cursor_at=cursor.last_message_at,
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
