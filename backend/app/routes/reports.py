from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import get_current_account
from ..models import SummaryReport, SummaryRun, TelegramAccount, UserChatBinding
from ..schemas import ReportOut, RunNowOut, RunOut
from ..services import summarizer

router = APIRouter()


def _report_with_range(report: SummaryReport, run: SummaryRun | None) -> ReportOut:
    out = ReportOut.model_validate(report)
    if run is not None:
        out = out.model_copy(update={
            "covered_from_at": run.covered_from_at,
            "covered_to_at": run.covered_to_at,
        })
    return out


@router.get("", response_model=list[ReportOut])
async def list_reports(
    chat_id: UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> list[ReportOut]:
    stmt = (
        select(SummaryReport, SummaryRun)
        .join(UserChatBinding, UserChatBinding.id == SummaryReport.user_chat_binding_id)
        .join(SummaryRun, SummaryRun.id == SummaryReport.summary_run_id)
        .where(UserChatBinding.telegram_account_id == account.id)
        .order_by(SummaryReport.generated_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if chat_id is not None:
        stmt = stmt.where(UserChatBinding.telegram_chat_id == chat_id)
    rows = (await session.execute(stmt)).all()
    return [_report_with_range(rep, run) for rep, run in rows]


class ReportCountOut(BaseModel):
    total: int


@router.get("/count", response_model=ReportCountOut)
async def count_reports(
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> ReportCountOut:
    stmt = (
        select(func.count(SummaryReport.id))
        .join(UserChatBinding, UserChatBinding.id == SummaryReport.user_chat_binding_id)
        .where(UserChatBinding.telegram_account_id == account.id)
    )
    total = (await session.execute(stmt)).scalar_one()
    return ReportCountOut(total=int(total or 0))


class UnreadCountEntry(BaseModel):
    chat_id: UUID
    count: int


@router.get("/unread-counts", response_model=list[UnreadCountEntry])
async def unread_counts(
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> list[UnreadCountEntry]:
    stmt = (
        select(UserChatBinding.telegram_chat_id, func.count(SummaryReport.id))
        .join(UserChatBinding, UserChatBinding.id == SummaryReport.user_chat_binding_id)
        .where(
            UserChatBinding.telegram_account_id == account.id,
            SummaryReport.read_at.is_(None),
        )
        .group_by(UserChatBinding.telegram_chat_id)
    )
    rows = (await session.execute(stmt)).all()
    return [UnreadCountEntry(chat_id=chat_id, count=int(count)) for chat_id, count in rows]


class MarkAllReadOut(BaseModel):
    updated: int


@router.post("/mark-all-read", response_model=MarkAllReadOut)
async def mark_all_read(
    chat_id: UUID | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> MarkAllReadOut:
    binding_stmt = select(UserChatBinding.id).where(
        UserChatBinding.telegram_account_id == account.id
    )
    if chat_id is not None:
        binding_stmt = binding_stmt.where(UserChatBinding.telegram_chat_id == chat_id)
    binding_ids = (await session.execute(binding_stmt)).scalars().all()
    if not binding_ids:
        return MarkAllReadOut(updated=0)
    res = await session.execute(
        update(SummaryReport)
        .where(
            SummaryReport.user_chat_binding_id.in_(binding_ids),
            SummaryReport.read_at.is_(None),
        )
        .values(read_at=func.now())
    )
    await session.commit()
    return MarkAllReadOut(updated=res.rowcount or 0)


@router.post("/{report_id}/read", status_code=204)
async def mark_report_read(
    report_id: UUID,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> None:
    owned = await _ensure_reports_owned(session, account.id, [report_id])
    if not owned:
        raise HTTPException(status_code=404, detail="report not found")
    await session.execute(
        update(SummaryReport)
        .where(SummaryReport.id == report_id, SummaryReport.read_at.is_(None))
        .values(read_at=func.now())
    )
    await session.commit()


@router.post("/{report_id}/unread", status_code=204)
async def mark_report_unread(
    report_id: UUID,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> None:
    owned = await _ensure_reports_owned(session, account.id, [report_id])
    if not owned:
        raise HTTPException(status_code=404, detail="report not found")
    await session.execute(
        update(SummaryReport)
        .where(SummaryReport.id == report_id)
        .values(read_at=None)
    )
    await session.commit()


@router.get("/{report_id}", response_model=ReportOut)
async def get_report(
    report_id: UUID,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> ReportOut:
    report = await session.get(SummaryReport, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="report not found")
    binding = await session.get(UserChatBinding, report.user_chat_binding_id)
    if binding is None or binding.telegram_account_id != account.id:
        raise HTTPException(status_code=404, detail="report not found")
    run = await session.get(SummaryRun, report.summary_run_id)
    return _report_with_range(report, run)


@router.post("/{report_id}/regenerate", response_model=RunNowOut)
async def regenerate_report(
    report_id: UUID,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> RunNowOut:
    """Re-run the LLM over the original report's message range. Creates a new run + report."""
    report = await session.get(SummaryReport, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="report not found")
    binding = await session.get(UserChatBinding, report.user_chat_binding_id)
    if binding is None or binding.telegram_account_id != account.id:
        raise HTTPException(status_code=404, detail="report not found")
    original_run = await session.get(SummaryRun, report.summary_run_id)
    if original_run is None or not original_run.covered_from_message_id:
        raise HTTPException(
            status_code=409,
            detail="original run missing message range; cannot regenerate",
        )

    spec = summarizer.FetchSpec(
        min_id=max(0, (original_run.covered_from_message_id or 1) - 1),
        max_id=(original_run.covered_to_message_id or 0) + 1,
        limit=2000,
        advance_cursor=False,
    )
    try:
        run, new_report = await summarizer.execute_run(
            session=session,
            binding_id=str(binding.id),
            trigger_source="manual:regenerate",
            fetch_spec=spec,
        )
    except summarizer.RunInProgressError:
        raise HTTPException(status_code=409, detail="另一份报告正在生成中，请稍候")
    return RunNowOut(
        run=RunOut.model_validate(run),
        report=_report_with_range(new_report, run) if new_report else None,
    )


class BulkDeleteIn(BaseModel):
    ids: list[UUID] = Field(..., min_length=1, max_length=200)


class BulkDeleteOut(BaseModel):
    deleted: int


async def _ensure_reports_owned(
    session: AsyncSession, account_id: UUID, ids: list[UUID]
) -> list[UUID]:
    """Return the subset of ids that exist AND belong to account_id."""
    stmt = (
        select(SummaryReport.id)
        .join(UserChatBinding, UserChatBinding.id == SummaryReport.user_chat_binding_id)
        .where(
            SummaryReport.id.in_(ids),
            UserChatBinding.telegram_account_id == account_id,
        )
    )
    rows = (await session.execute(stmt)).scalars().all()
    return list(rows)


@router.delete("/{report_id}", status_code=204)
async def delete_report(
    report_id: UUID,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> None:
    owned = await _ensure_reports_owned(session, account.id, [report_id])
    if not owned:
        raise HTTPException(status_code=404, detail="report not found")
    await session.execute(
        delete(SummaryReport).where(SummaryReport.id == report_id)
    )
    await session.commit()


@router.post("/bulk-delete", response_model=BulkDeleteOut)
async def bulk_delete_reports(
    payload: BulkDeleteIn,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> BulkDeleteOut:
    owned = await _ensure_reports_owned(session, account.id, payload.ids)
    if not owned:
        return BulkDeleteOut(deleted=0)
    res = await session.execute(
        delete(SummaryReport).where(SummaryReport.id.in_(owned))
    )
    await session.commit()
    return BulkDeleteOut(deleted=res.rowcount or len(owned))


@router.get("/runs/recent", response_model=list[RunOut])
async def recent_runs(
    limit: int = Query(default=50, ge=1, le=200),
    status: str | None = Query(default=None, description="filter by run.status (e.g. 'running')"),
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> list[RunOut]:
    stmt = (
        select(SummaryRun)
        .where(SummaryRun.telegram_account_id == account.id)
        .order_by(SummaryRun.created_at.desc())
        .limit(limit)
    )
    if status:
        stmt = stmt.where(SummaryRun.status == status)
    rows = (await session.execute(stmt)).scalars().all()
    return [RunOut.model_validate(r) for r in rows]
