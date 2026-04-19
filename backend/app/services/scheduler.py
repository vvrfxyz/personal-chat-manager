"""APScheduler wrapper — wired up in Phase 1 but job functions populated later."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


def _tick_placeholder() -> None:
    # Filled in by routes/summarizer module once ready.
    pass


def start() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler()
    from .summarizer import dispatch_due_runs

    _scheduler.add_job(
        dispatch_due_runs,
        trigger=IntervalTrigger(minutes=1),
        id="dispatch_due_runs",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
        # Delay first tick by 60s after boot. NOTE: do not pass None here —
        # APScheduler treats next_run_time=None as "paused", and the job
        # would never fire (that bug silently disabled auto-summaries).
        next_run_time=datetime.now(timezone.utc) + timedelta(seconds=60),
    )
    _scheduler.start()
    logger.info("APScheduler started — dispatch_due_runs every 60s")


def shutdown() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
    logger.info("APScheduler stopped")
