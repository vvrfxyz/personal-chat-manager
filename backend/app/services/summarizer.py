"""OpenAI summarizer + run executor. Populated further in task #7."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from openai import AsyncOpenAI
from sqlalchemy import and_, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import SessionLocal
from ..models import (
    SummaryCursor,
    SummaryReport,
    SummaryRule,
    SummaryRun,
    TelegramAccount,
    TelegramChat,
    TelegramMessage,
    UserChatBinding,
)
from ..security import decrypt
from .telegram import build_client
from .templates import get_template
from .tools import TOOL_SCHEMAS, dispatch_tool

logger = logging.getLogger("app.summarizer")
settings = get_settings()


class RunInProgressError(RuntimeError):
    """Raised when a run is started for a binding that already has one in flight."""


class SummarizeError(RuntimeError):
    """Raised inside `_summarize` with partial token counts so the caller
    can persist them on the failed run (otherwise a tool-loop failure
    hides its token cost)."""

    def __init__(self, message: str, *, total_in: int = 0, total_out: int = 0) -> None:
        super().__init__(message)
        self.total_in = total_in
        self.total_out = total_out


# Only these templates run the tool loop. Other templates get a single
# LLM call for cost/latency parity with the old behaviour — see plan M3.
_TOOL_TEMPLATES = {"signals"}


# Per-binding re-entrancy lock. Prevents scheduler and manual clicks from
# double-running the same binding (which wastes tokens and produces duplicate
# reports). Single-process only; fine for this deployment.
_binding_locks: dict[str, asyncio.Lock] = {}


def _lock_for(binding_id: str) -> asyncio.Lock:
    lock = _binding_locks.get(binding_id)
    if lock is None:
        lock = asyncio.Lock()
        _binding_locks[binding_id] = lock
    return lock


# Per-binding tracker for "this run hit the message cap and we fast-rescheduled
# to drain the backlog." Prevents the cascade where a high-velocity chat keeps
# capping every 2 min and produces dozens of reports per hour. After
# `_MAX_FAST_RESCHEDULES` capped runs in a row we fall back to the normal
# cadence — older messages will accumulate, but the user stops being spammed.
# In-memory only by design: a backend restart resets the counter, which is
# safe because the absolute worst case is a few extra fast runs.
_consecutive_cap_hits: dict[str, int] = {}
_MAX_FAST_RESCHEDULES = 3
_CATCH_UP_INTERVAL = timedelta(minutes=2)
_CATCH_UP_CADENCE_DELTAS: dict[str, timedelta] = {
    "continuous": timedelta(seconds=0),
    "every_2m": timedelta(minutes=2),
    "slow_background": timedelta(minutes=15),
}
_CATCH_UP_BATCH_SIZES = {500, 1000, 2000}
_CATCH_UP_RESULT_TYPES = {"archive_reports", "daily_digest", "latest_summary"}
_CATCH_UP_FAILURE_POLICIES = {"pause", "retry_once", "skip_batch"}
_FETCH_TIMEOUT_SECONDS = 10 * 60
_SUMMARIZE_TIMEOUT_SECONDS = 45 * 60


def _cursor_meta(cursor: SummaryCursor | None) -> dict[str, Any]:
    if cursor is None:
        return {}
    return dict(cursor.cursor_metadata or {})


def _catch_up_meta(cursor: SummaryCursor | None) -> dict[str, Any]:
    meta = _cursor_meta(cursor).get("catch_up")
    return dict(meta) if isinstance(meta, dict) else {}


def _catch_up_config(cursor: SummaryCursor | None) -> dict[str, Any]:
    meta = _catch_up_meta(cursor)
    batch_size = int(meta.get("batch_size") or 500)
    if batch_size not in _CATCH_UP_BATCH_SIZES:
        batch_size = 500
    cadence = str(meta.get("cadence") or "every_2m")
    if cadence not in _CATCH_UP_CADENCE_DELTAS:
        cadence = "every_2m"
    result_type = str(meta.get("result_type") or "archive_reports")
    if result_type not in _CATCH_UP_RESULT_TYPES:
        result_type = "archive_reports"
    failure_policy = str(meta.get("failure_policy") or "pause")
    if failure_policy not in _CATCH_UP_FAILURE_POLICIES:
        failure_policy = "pause"
    return {
        **meta,
        "batch_size": batch_size,
        "cadence": cadence,
        "result_type": result_type,
        "failure_policy": failure_policy,
        "batches_completed": int(meta.get("batches_completed") or 0),
        "failed_batches": int(meta.get("failed_batches") or 0),
        "reports_generated": int(meta.get("reports_generated") or 0),
        "tokens_used": int(meta.get("tokens_used") or 0),
    }


def _catch_up_active(cursor: SummaryCursor | None) -> bool:
    return bool(_catch_up_meta(cursor).get("active"))


def _set_catch_up_meta(cursor: SummaryCursor, patch: dict[str, Any] | None) -> None:
    meta = _cursor_meta(cursor)
    if patch is None:
        meta.pop("catch_up", None)
    else:
        meta["catch_up"] = patch
    cursor.cursor_metadata = meta


def _normal_next_run(rule: SummaryRule | None, enabled: bool, now: datetime) -> datetime | None:
    if rule is None or not enabled or rule.frequency == "manual":
        return None
    delta = frequency_delta(rule.frequency)
    return (now + delta) if delta is not None else None


def _catch_up_next_run_at(meta: dict[str, Any], now: datetime) -> datetime:
    cadence = str(meta.get("cadence") or "every_2m")
    return now + _CATCH_UP_CADENCE_DELTAS.get(cadence, _CATCH_UP_INTERVAL)


def _catch_up_limit_reason(meta: dict[str, Any]) -> str | None:
    max_batches = meta.get("max_batches")
    if max_batches is not None and int(meta.get("batches_completed") or 0) >= int(max_batches):
        return "max_batches"
    max_tokens = meta.get("max_tokens")
    if max_tokens is not None and int(meta.get("tokens_used") or 0) >= int(max_tokens):
        return "max_tokens"
    max_reports = meta.get("max_reports")
    if max_reports is not None and int(meta.get("reports_generated") or 0) >= int(max_reports):
        return "max_reports"
    return None


async def _await_with_timeout(awaitable, seconds: int, label: str):
    try:
        return await asyncio.wait_for(awaitable, timeout=seconds)
    except TimeoutError as exc:
        raise TimeoutError(f"{label} timed out after {seconds}s") from exc


def _openai_client() -> AsyncOpenAI | None:
    if not settings.openai_api_key:
        return None
    kwargs: dict[str, Any] = {"api_key": settings.openai_api_key}
    if settings.openai_base_url:
        kwargs["base_url"] = settings.openai_base_url
    return AsyncOpenAI(**kwargs)


@dataclass
class FetchedMessage:
    id: int
    date: datetime
    sender: str | None
    # text is None for media-only messages. `_format_messages_for_prompt`
    # filters these out; persistence keeps them (reply chains can land on
    # a photo with no caption).
    text: str | None
    sender_id: int | None = None
    reply_to_msg_id: int | None = None
    grouped_id: int | None = None
    raw_meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class FetchSpec:
    """Describes what window of messages to pull.

    Either cursor-forward (min_id/after_dt) or bounded (both ends). When
    `advance_cursor` is False we generate a one-off report without
    touching `summary_cursors` — used for custom-range and regenerate.
    """

    min_id: int | None = None
    max_id: int | None = None
    after_dt: datetime | None = None
    before_dt: datetime | None = None
    limit: int = 500
    advance_cursor: bool = True


# SYSTEM_PROMPT moved into services/templates.py; each rule.template_key picks one.

REPORT_SCHEMA = {
    "type": "object",
    "required": [
        "title",
        "executive_summary",
        "key_points",
        "decisions",
        "action_items",
        "risks",
        "mentions",
        "links",
    ],
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string"},
        "executive_summary": {"type": "string"},
        "key_points": {"type": "array", "items": {"type": "string"}},
        "decisions": {"type": "array", "items": {"type": "string"}},
        "action_items": {"type": "array", "items": {"type": "string"}},
        "risks": {"type": "array", "items": {"type": "string"}},
        "mentions": {"type": "array", "items": {"type": "string"}},
        "links": {"type": "array", "items": {"type": "string"}},
    },
}


FREQUENCY_DELTAS: dict[str, timedelta] = {
    "hourly": timedelta(hours=1),
    "every_6h": timedelta(hours=6),
    "every_12h": timedelta(hours=12),
    "daily": timedelta(days=1),
}


def frequency_delta(freq: str) -> timedelta | None:
    return FREQUENCY_DELTAS.get(freq)


def _anchor_for_mode(mode: str, now: datetime) -> datetime | None:
    # Only used as a fallback when binding.first_summary_anchor_at is null
    # (old rows). New code always relies on the stored anchor so it doesn't
    # slide forward on each skipped run.
    if mode == "last_24h":
        return now - timedelta(hours=24)
    if mode == "last_7d":
        return now - timedelta(days=7)
    if mode == "from_now":
        return now
    return None


def _resolve_peer(external_chat_id: int, chat_type: str, access_hash: str | None, username: str | None):
    """Build an InputPeer from the stored metadata so we don't need Telethon's cache."""
    from telethon.tl.types import InputPeerChannel, InputPeerChat, InputPeerUser

    if chat_type in ("channel", "supergroup"):
        if access_hash is not None:
            try:
                return InputPeerChannel(channel_id=int(external_chat_id), access_hash=int(access_hash))
            except (TypeError, ValueError):
                pass
        if username:
            return username  # Telethon will resolve @username server-side
        raise RuntimeError(
            f"cannot resolve {chat_type} {external_chat_id}: no access_hash/username (re-sync required)"
        )
    if chat_type == "group":
        return InputPeerChat(chat_id=int(external_chat_id))
    if chat_type == "private":
        if access_hash is None:
            raise RuntimeError(f"cannot resolve private peer {external_chat_id}: no access_hash")
        return InputPeerUser(user_id=int(external_chat_id), access_hash=int(access_hash))
    # fallback — let Telethon try
    return int(external_chat_id)


_FETCH_BATCH = 500  # per-iter_messages cap; Telethon will paginate internally

# Result of one fetch run. `hit_cap` tells the caller whether there may
# still be unfetched messages past `last_raw_id` (for fast reschedule).
@dataclass
class FetchResult:
    messages: list[FetchedMessage]
    last_raw_id: int | None
    hit_cap: bool


async def _fetch_messages(
    *,
    session_string: str,
    external_chat_id: int,
    chat_type: str,
    access_hash: str | None,
    username: str | None,
    spec: FetchSpec,
    session: AsyncSession | None = None,
    chat_uuid: uuid.UUID | None = None,
) -> FetchResult:
    """Drain messages past the spec's lower bound, batch by batch, until we run
    out or we hit `spec.limit` (the run-level cap). Returns every textual
    message plus bookkeeping so the caller can detect a capped run and
    reschedule early.

    If both `session` and `chat_uuid` are provided, every fetched message
    (including media without caption) is upserted into `telegram_messages`
    so cross-window reply chains can be traced later. When either is None
    (e.g. `scripts/dump_window.py`) upsert is skipped and only text-bearing
    messages are returned — behaviour preserved for legacy callers.
    """
    out: list[FetchedMessage] = []        # text-bearing, fed to prompt
    all_out: list[FetchedMessage] = []    # everything, for upsert
    raw_total = 0
    last_raw_id: int | None = None
    hit_cap = False
    cap = max(int(spec.limit), 1)

    current_min_id = int(spec.min_id) if spec.min_id else 0
    # offset_date only makes sense for the first batch — subsequent batches
    # advance via current_min_id. Telethon treats offset_date+min_id as "start
    # from whichever is more restrictive", which is what we want.
    first_offset_date = spec.after_dt

    async with build_client(session_string) as client:
        peer = _resolve_peer(external_chat_id, chat_type, access_hash, username)

        stop_by_before = False
        while raw_total < cap and not stop_by_before:
            remaining = cap - raw_total
            batch_limit = min(_FETCH_BATCH, remaining)

            kwargs: dict[str, Any] = {"limit": batch_limit, "reverse": True}
            if current_min_id:
                kwargs["min_id"] = current_min_id
            if spec.max_id:
                kwargs["max_id"] = int(spec.max_id)
            if first_offset_date is not None and current_min_id == 0:
                kwargs["offset_date"] = first_offset_date

            batch_raw = 0
            async for msg in client.iter_messages(peer, **kwargs):
                batch_raw += 1
                last_raw_id = int(msg.id)
                # Telethon (reverse=True) yields oldest-first. Once we're past
                # the requested upper time bound we can abandon the whole scan.
                if spec.before_dt is not None and msg.date > spec.before_dt:
                    stop_by_before = True
                    break
                text = (msg.message or "").strip() or None
                sender_name: str | None = None
                if msg.sender:
                    parts = [
                        getattr(msg.sender, "first_name", None),
                        getattr(msg.sender, "last_name", None),
                    ]
                    sender_name = " ".join(p for p in parts if p) or getattr(
                        msg.sender, "username", None
                    )
                reply_to_top_id = (
                    getattr(msg.reply_to, "reply_to_top_id", None)
                    if getattr(msg, "reply_to", None) is not None
                    else None
                )
                raw_meta: dict[str, Any] = {}
                if msg.grouped_id:
                    raw_meta["grouped_id"] = int(msg.grouped_id)
                if reply_to_top_id:
                    raw_meta["reply_to_top_id"] = int(reply_to_top_id)
                if msg.edit_date:
                    raw_meta["edit_date"] = msg.edit_date.isoformat()
                fm = FetchedMessage(
                    id=int(msg.id),
                    date=msg.date,
                    sender=sender_name,
                    text=text,
                    sender_id=(int(msg.sender_id) if msg.sender_id is not None else None),
                    reply_to_msg_id=(int(msg.reply_to_msg_id) if msg.reply_to_msg_id else None),
                    grouped_id=(int(msg.grouped_id) if msg.grouped_id else None),
                    raw_meta=raw_meta,
                )
                all_out.append(fm)
                if text:
                    out.append(fm)
            raw_total += batch_raw
            if stop_by_before:
                break
            if batch_raw < batch_limit:
                # Telegram exhausted; nothing more to drain.
                break
            if last_raw_id is None:
                break
            if raw_total >= cap:
                hit_cap = True
                break
            current_min_id = last_raw_id  # next batch starts past this id

    if session is not None and chat_uuid is not None and all_out:
        await _upsert_messages(session, chat_uuid, all_out)

    return FetchResult(messages=out, last_raw_id=last_raw_id, hit_cap=hit_cap)


async def _upsert_messages(
    session: AsyncSession,
    chat_uuid: uuid.UUID,
    msgs: list[FetchedMessage],
) -> None:
    """Batch upsert keyed on (telegram_chat_id, external_msg_id). Covers
    message edits by overwriting text + raw_meta; leaves date/sender intact
    since those don't change after first insert."""
    rows = [
        {
            "telegram_chat_id": chat_uuid,
            "external_msg_id": m.id,
            "date": m.date,
            "sender_id": m.sender_id,
            "sender_name": m.sender,
            "reply_to_msg_id": m.reply_to_msg_id,
            "text": m.text,
            "raw_meta": m.raw_meta,
        }
        for m in msgs
    ]
    stmt = pg_insert(TelegramMessage).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["telegram_chat_id", "external_msg_id"],
        set_={
            "text": stmt.excluded.text,
            "raw_meta": stmt.excluded.raw_meta,
            "updated_at": datetime.now(timezone.utc),
        },
    )
    await session.execute(stmt)


def _format_messages_for_prompt(msgs: list[FetchedMessage]) -> str:
    lines: list[str] = []
    for m in msgs:
        if m.text is None:
            continue
        who = m.sender or "unknown"
        marker = (
            f"[id={m.id} ↪{m.reply_to_msg_id}]"
            if m.reply_to_msg_id
            else f"[id={m.id}]"
        )
        lines.append(f"{marker} [{m.date.isoformat()}] {who}: {m.text}")
    return "\n".join(lines)


def _normalize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    payload.setdefault("title", "Telegram chat summary")
    payload.setdefault("executive_summary", "")
    for k in ("key_points", "decisions", "action_items", "risks", "mentions", "links"):
        payload.setdefault(k, [])
    return payload


async def _summarize(
    messages: list[FetchedMessage],
    language: str,
    template_key: str = "default",
    carry_over_questions: list[str] | None = None,
    session: AsyncSession | None = None,
    chat_uuid: uuid.UUID | None = None,
) -> tuple[dict[str, Any], int | None, int | None]:
    client = _openai_client()
    if client is None or not messages:
        sample = [m.text for m in messages[:5] if m.text is not None]
        return (
            {
                "title": f"{len(messages)} messages summarized (mock)",
                "executive_summary": "OpenAI key not configured; returning a mock report.",
                "key_points": sample,
                "decisions": [],
                "action_items": [],
                "risks": [],
                "mentions": [],
                "links": [],
            },
            None,
            None,
        )

    content = _format_messages_for_prompt(messages)
    carry_block = ""
    if carry_over_questions:
        carry_lines = "\n".join(f"- {q}" for q in carry_over_questions)
        carry_block = (
            "\nCarry-over from prior reports — questions that were raised in earlier\n"
            "windows but had no substantive answer at the time. For each one, check\n"
            "the messages below: if answered now, pair it into `decisions`. If still\n"
            "unanswered, re-list it under `mentions` so it persists.\n"
            f"```\n{carry_lines}\n```\n"
        )
    user_prompt = (
        f"Language: {language}\n"
        f"{carry_block}"
        f"Messages (chronological):\n"
        f"```\n{content}\n```\n\n"
        "Produce the JSON object now."
    )

    tpl = get_template(template_key)
    convo: list[dict[str, Any]] = [
        {"role": "system", "content": tpl["system_prompt"]},
        {"role": "user", "content": user_prompt},
    ]

    tools_enabled = (
        template_key in _TOOL_TEMPLATES
        and session is not None
        and chat_uuid is not None
    )
    max_iters = settings.max_tool_iterations if tools_enabled else 1

    base_kwargs: dict[str, Any] = {
        "model": settings.openai_model,
        "response_format": {"type": "json_object"},
    }
    if settings.openai_reasoning_effort:
        base_kwargs["reasoning_effort"] = settings.openai_reasoning_effort

    logger.info(
        "summarize: model=%s template=%s reasoning=%s messages=%d tools=%s max_iters=%d",
        settings.openai_model,
        tpl["id"],
        settings.openai_reasoning_effort or "(default)",
        len(messages),
        tools_enabled,
        max_iters,
    )

    total_in = 0
    total_out = 0

    for iteration in range(max_iters):
        kwargs = dict(base_kwargs, messages=convo)
        if tools_enabled:
            kwargs["tools"] = TOOL_SCHEMAS

        try:
            resp = await client.chat.completions.create(**kwargs)
        except Exception as exc:  # noqa: BLE001
            body = getattr(exc, "response", None)
            detail = None
            if body is not None:
                try:
                    detail = body.text if hasattr(body, "text") else str(body)
                except Exception:  # noqa: BLE001
                    detail = None
            logger.error(
                "openai call failed (iter=%d): %s %s | body=%s",
                iteration, type(exc).__name__, exc,
                (detail[:500] if detail else "<none>"),
            )
            raise SummarizeError(str(exc), total_in=total_in, total_out=total_out) from exc

        usage = resp.usage
        total_in += getattr(usage, "prompt_tokens", 0) or 0
        total_out += getattr(usage, "completion_tokens", 0) or 0
        msg = resp.choices[0].message

        tool_calls = getattr(msg, "tool_calls", None) if tools_enabled else None
        if not tool_calls:
            content_text = msg.content or "{}"
            try:
                payload = json.loads(content_text)
            except json.JSONDecodeError as exc:
                logger.error(
                    "openai returned non-JSON content (iter=%d): %s... (err=%s)",
                    iteration, content_text[:200], exc,
                )
                raise SummarizeError(
                    f"non_json_content: {exc}",
                    total_in=total_in, total_out=total_out,
                ) from exc
            logger.info(
                "summarize ok: total_in=%d total_out=%d iters=%d",
                total_in, total_out, iteration + 1,
            )
            return _normalize_payload(payload), total_in, total_out

        # Forward the assistant turn (must include tool_calls) so the
        # tool results can reference them by id in the next API call.
        convo.append({
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments or "{}",
                    },
                }
                for tc in tool_calls
            ],
        })
        for tc in tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                result = {"status": "error", "reason": "malformed_arguments_json"}
            else:
                result = await dispatch_tool(
                    tc.function.name, args,
                    session=session, chat_uuid=chat_uuid,
                )
                await session.commit()
            convo.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": json.dumps(result, ensure_ascii=False),
            })
        logger.info(
            "tool_loop iter=%d tools=%d total_in=%d total_out=%d",
            iteration, len(tool_calls), total_in, total_out,
        )

    raise SummarizeError(
        f"tool loop exceeded {max_iters} iterations",
        total_in=total_in, total_out=total_out,
    )


def _build_markdown(report: dict[str, Any]) -> str:
    def _list(label: str, items: list[str]) -> str:
        if not items:
            return ""
        body = "\n".join(f"- {x}" for x in items)
        return f"\n## {label}\n{body}\n"

    return (
        f"# {report['title']}\n\n"
        f"{report['executive_summary']}\n"
        + _list("Key points", report.get("key_points", []))
        + _list("Decisions", report.get("decisions", []))
        + _list("Action items", report.get("action_items", []))
        + _list("Risks", report.get("risks", []))
        + _list("Mentions", report.get("mentions", []))
        + _list("Links", report.get("links", []))
    )


async def _summarize_daily_parts(
    parts: list[dict[str, Any]],
    language: str,
    template_key: str,
    *,
    session: AsyncSession,
    chat_uuid: uuid.UUID,
) -> tuple[dict[str, Any], int, int]:
    messages: list[FetchedMessage] = []
    for idx, part in enumerate(parts, start=1):
        date = datetime.fromisoformat(part["to_at"].replace("Z", "+00:00")) if part.get("to_at") else datetime.now(timezone.utc)
        label = f"积压批次 {idx}"
        covered = " - ".join(x for x in [part.get("from_at"), part.get("to_at")] if x)
        text = f"{label}\n范围：{covered}\n\n{part.get('markdown') or ''}".strip()
        messages.append(FetchedMessage(id=idx, date=date, sender="Personal Chat Manager", text=text))
    payload, input_tokens, output_tokens = await _summarize(
        messages,
        language,
        template_key,
        carry_over_questions=[],
        session=session,
        chat_uuid=chat_uuid,
    )
    payload["title"] = f"积压合并日报 · {payload['title']}"
    return payload, input_tokens, output_tokens


_CARRY_OVER_LOOKBACK_REPORTS = 3
_CARRY_OVER_MAX_QUESTIONS = 12
_CARRY_OVER_TEMPLATES = {"signals"}  # only templates whose `mentions` field stores questions


def _looks_like_question(s: str) -> bool:
    """Heuristic: distinguish new-format question entries from legacy
    name-only mentions. The signals prompt asks the model to format each open
    question as `Q (asker): text` and to include normal interrogative text.
    Legacy reports (default template, or pre-rewrite signals) have plain
    names like "Andres Nava" — those must NOT be fed as carry-over or the
    next prompt thinks "Andres Nava" is an unanswered question.
    """
    if not s:
        return False
    if s.startswith("Q ") or s.startswith("Q(") or s.startswith("Q（"):
        return True
    if "?" in s or "？" in s:
        return True
    # Chinese interrogative tells without a question mark
    for marker in ("吗", "怎么", "如何", "是否", "能不能", "可不可以", "有没有"):
        if marker in s:
            return True
    return False


async def _gather_carry_over_questions(
    session: AsyncSession,
    binding_id,
    template_key: str,
) -> list[str]:
    """Pull unanswered questions from recent reports of this binding.

    Only meaningful for templates that repurpose `mentions` for open questions
    (currently just `signals`). For other templates `mentions` holds people
    names — feeding those as "carry-over questions" would be nonsense.

    Even within signals, we filter for question-shaped strings so legacy
    reports (generated before the mentions repurpose) don't pollute the
    next prompt with names-as-questions.
    """
    if template_key not in _CARRY_OVER_TEMPLATES:
        return []
    rows = (
        await session.execute(
            select(SummaryReport)
            .where(SummaryReport.user_chat_binding_id == binding_id)
            .order_by(SummaryReport.generated_at.desc())
            .limit(_CARRY_OVER_LOOKBACK_REPORTS)
        )
    ).scalars().all()
    seen: set[str] = set()
    out: list[str] = []
    for rep in rows:
        for m in (rep.mentions or []):
            if not isinstance(m, str):
                continue
            q = m.strip()
            if not q or q in seen or not _looks_like_question(q):
                continue
            seen.add(q)
            out.append(q)
            if len(out) >= _CARRY_OVER_MAX_QUESTIONS:
                return out
    return out


async def execute_run(
    *,
    session: AsyncSession,
    binding_id: str,
    trigger_source: str = "manual",
    fetch_spec: FetchSpec | None = None,
) -> tuple[SummaryRun, SummaryReport | None]:
    """Fetch → summarize → persist. Returns (run, report-or-None).

    `fetch_spec`:
      - None (default) → cursor-driven incremental run. Advances cursor on success.
      - provided → one-off run bounded by the spec. Cursor untouched.

    Never raises on business failures; marks the run as `failed` instead.
    Raises RunInProgressError if another run for the same binding is already
    underway — callers decide whether to surface (manual: 409) or swallow
    (scheduler: log and move on).
    """
    lock = _lock_for(binding_id)
    if lock.locked():
        raise RunInProgressError(binding_id)
    async with lock:
        return await _execute_run_locked(
            session=session,
            binding_id=binding_id,
            trigger_source=trigger_source,
            fetch_spec=fetch_spec,
        )


async def _execute_run_locked(
    *,
    session: AsyncSession,
    binding_id: str,
    trigger_source: str,
    fetch_spec: FetchSpec | None,
) -> tuple[SummaryRun, SummaryReport | None]:
    now = datetime.now(timezone.utc)

    result = await session.execute(
        select(UserChatBinding).where(UserChatBinding.id == binding_id)
    )
    binding = result.scalar_one()
    chat = await session.get(TelegramChat, binding.telegram_chat_id)
    account = await session.get(TelegramAccount, binding.telegram_account_id)
    assert chat is not None and account is not None

    rule_q = await session.execute(
        select(SummaryRule).where(SummaryRule.user_chat_binding_id == binding.id)
    )
    rule = rule_q.scalar_one_or_none()
    cursor_q = await session.execute(
        select(SummaryCursor).where(SummaryCursor.user_chat_binding_id == binding.id)
    )
    cursor = cursor_q.scalar_one_or_none()
    catch_up_active = _catch_up_active(cursor)
    catch_up = _catch_up_config(cursor) if catch_up_active else {}

    language = (rule.preferred_language if rule else "zh-CN")
    default_limit = catch_up.get("batch_size") or (rule.max_messages_per_run if rule else 500)

    # Build the effective FetchSpec.
    if fetch_spec is None:
        if cursor and cursor.last_message_id:
            after_dt = None
        else:
            # Trust the stored bootstrap anchor. It was stamped when the user
            # picked the first_summary_mode — recomputing 'now' here causes
            # the window to slide forward on every skipped run, dropping messages.
            after_dt = binding.first_summary_anchor_at or _anchor_for_mode(
                binding.first_summary_mode, now
            )
        spec = FetchSpec(
            min_id=cursor.last_message_id if cursor else None,
            after_dt=after_dt,
            limit=default_limit,
            advance_cursor=True,
        )
    else:
        spec = fetch_spec
        if spec.limit <= 0:
            spec.limit = default_limit

    binding.last_run_at = now
    run = SummaryRun(
        telegram_account_id=account.id,
        telegram_chat_id=chat.id,
        user_chat_binding_id=binding.id,
        status="running",
        trigger_source=trigger_source,
        started_at=now,
        model_name=settings.openai_model if settings.openai_api_key else "mock",
    )
    session.add(run)
    await session.flush()
    # Persist the running marker before network-heavy Telegram/OpenAI work.
    # Otherwise a stuck external call leaves Postgres "idle in transaction"
    # and the scheduler cannot reason about what is actually in flight.
    await session.commit()
    logger.info(
        "run start binding=%s chat=%s trigger=%s run_id=%s advance=%s",
        binding.id, chat.title, trigger_source, run.id, spec.advance_cursor,
    )

    fetch_result: FetchResult | None = None
    messages: list[FetchedMessage] = []
    try:
        session_string = decrypt(account.session_encrypted)
        logger.debug(
            "run fetch: chat_external=%s type=%s min_id=%s max_id=%s after=%s before=%s limit=%d",
            chat.external_chat_id, chat.chat_type, spec.min_id, spec.max_id,
            spec.after_dt, spec.before_dt, spec.limit,
        )
        fetch_result = await _await_with_timeout(
            _fetch_messages(
                session_string=session_string,
                external_chat_id=chat.external_chat_id,
                chat_type=chat.chat_type,
                access_hash=chat.access_hash,
                username=chat.username,
                spec=spec,
                session=session,
                chat_uuid=chat.id,
            ),
            _FETCH_TIMEOUT_SECONDS,
            "telegram fetch",
        )
        messages = fetch_result.messages
        logger.info(
            "run fetched %d messages hit_cap=%s last_raw_id=%s",
            len(messages), fetch_result.hit_cap, fetch_result.last_raw_id,
        )
        # `_fetch_messages` upserts raw messages for later tool lookup. Commit
        # those writes before the long OpenAI phase so we do not hold a DB
        # transaction open while waiting on the network.
        await session.commit()

        min_needed = rule.min_message_count if rule else 1
        if len(messages) < min_needed:
            # Even on skip, if we saw non-textual activity past the cursor, roll
            # the cursor forward so the next run doesn't re-scan the same tail.
            if (
                spec.advance_cursor
                and fetch_result.last_raw_id is not None
                and (cursor is None or fetch_result.last_raw_id > (cursor.last_message_id or 0))
            ):
                if cursor is None:
                    cursor = SummaryCursor(
                        user_chat_binding_id=binding.id,
                        last_message_id=fetch_result.last_raw_id,
                        last_message_at=now,
                    )
                    session.add(cursor)
                else:
                    cursor.last_message_id = fetch_result.last_raw_id
            run.status = "skipped"
            run.finished_at = datetime.now(timezone.utc)
            run.fetched_message_count = len(messages)
            # No new content → we've caught up. Clear any in-flight cap-hit
            # counter and align next_run_at with the normal cadence so we
            # don't keep polling on the fast 2-min cycle.
            if spec.advance_cursor and catch_up_active and cursor is not None:
                meta = _catch_up_config(cursor)
                meta["active"] = False
                meta["completed_at"] = datetime.now(timezone.utc).isoformat()
                meta["stop_reason"] = "caught_up"
                _set_catch_up_meta(cursor, meta)
            if spec.advance_cursor and rule and rule.frequency != "manual":
                _consecutive_cap_hits.pop(str(binding.id), None)
                rule.next_run_at = _normal_next_run(rule, binding.auto_summary_enabled, datetime.now(timezone.utc))
            elif spec.advance_cursor and catch_up_active and rule:
                rule.next_run_at = None
            await session.commit()
            return run, None

        template_key = rule.template_key if rule else "default"

        # Cross-window Q&A handling: a question raised at the tail of window N
        # may get answered at the head of window N+1. To catch that, feed the
        # last few reports' `mentions` (which holds open questions for the
        # signals template) back into the prompt as carry-over so the LLM can
        # pair them with answers in the new window.
        carry_over_questions = await _gather_carry_over_questions(
            session, binding.id, template_key
        )
        await session.commit()

        payload, input_tokens, output_tokens = await _await_with_timeout(
            _summarize(
                messages, language, template_key,
                carry_over_questions=carry_over_questions,
                session=session,
                chat_uuid=chat.id,
            ),
            _SUMMARIZE_TIMEOUT_SECONDS,
            "summary generation",
        )
        md = _build_markdown(payload)

        last_msg = messages[-1]
        report: SummaryReport | None = None
        report_created = False
        if catch_up_active and catch_up.get("result_type") == "daily_digest" and cursor is not None:
            meta = _catch_up_config(cursor)
            parts = meta.get("daily_parts")
            if not isinstance(parts, list):
                parts = []
            parts.append({
                "title": payload["title"],
                "markdown": md,
                "from_message_id": messages[0].id,
                "to_message_id": last_msg.id,
                "from_at": messages[0].date.isoformat(),
                "to_at": last_msg.date.isoformat(),
                "message_count": len(messages),
            })
            meta["daily_parts"] = parts
            _set_catch_up_meta(cursor, meta)
        else:
            report = SummaryReport(
                summary_run_id=run.id,
                user_chat_binding_id=binding.id,
                title=payload["title"],
                executive_summary=payload.get("executive_summary"),
                key_points=payload.get("key_points", []),
                decisions=payload.get("decisions", []),
                action_items=payload.get("action_items", []),
                risks=payload.get("risks", []),
                mentions=payload.get("mentions", []),
                links=payload.get("links", []),
                content_markdown=md,
                language=language,
            )
            session.add(report)
            await session.flush()
            report_created = True
        # Advance cursor to the raw-last id so non-textual messages at the tail
        # don't get rescanned on the next run. Fall back to the last textual
        # message if, somehow, raw id wasn't tracked.
        cursor_id = fetch_result.last_raw_id or last_msg.id
        if spec.advance_cursor:
            if cursor is None:
                cursor = SummaryCursor(
                    user_chat_binding_id=binding.id,
                    last_message_id=cursor_id,
                    last_message_at=last_msg.date,
                )
                session.add(cursor)
            else:
                cursor.last_message_id = cursor_id
                cursor.last_message_at = last_msg.date

        now2 = datetime.now(timezone.utc)
        run.status = "success"
        run.finished_at = now2
        run.fetched_message_count = len(messages)
        run.covered_from_message_id = messages[0].id
        run.covered_to_message_id = last_msg.id
        run.covered_from_at = messages[0].date
        run.covered_to_at = last_msg.date
        run.input_token_count = input_tokens
        run.output_token_count = output_tokens
        binding.last_success_at = now2
        binding.last_error_at = None
        binding.last_error_message = None
        logger.info(
            "run success run_id=%s in=%s out=%s model=%s advanced_cursor=%s hit_cap=%s",
            run.id, input_tokens, output_tokens, run.model_name,
            spec.advance_cursor, fetch_result.hit_cap,
        )

        if spec.advance_cursor and catch_up_active and cursor is not None:
            meta = _catch_up_config(cursor)
            meta["batches_completed"] = int(meta.get("batches_completed") or 0) + 1
            meta["tokens_used"] = int(meta.get("tokens_used") or 0) + input_tokens + output_tokens
            meta["last_batch_at"] = now2.isoformat()
            if report_created and report is not None:
                meta["reports_generated"] = int(meta.get("reports_generated") or 0) + 1
                report_ids = meta.get("report_ids")
                if not isinstance(report_ids, list):
                    report_ids = []
                report_ids.append(str(report.id))
                meta["report_ids"] = report_ids[-100:]

            stop_reason = None if fetch_result.hit_cap else "caught_up"
            limit_reason = _catch_up_limit_reason(meta)
            if limit_reason is not None:
                stop_reason = limit_reason

            if stop_reason is None:
                meta["active"] = True
                _set_catch_up_meta(cursor, meta)
                if rule is not None:
                    rule.next_run_at = _catch_up_next_run_at(meta, now2)
                logger.info(
                    "catch-up continuing cadence=%s next=%s",
                    meta.get("cadence"), rule.next_run_at if rule else None,
                )
            else:
                meta["active"] = False
                meta["stop_reason"] = stop_reason
                meta["completed_at" if stop_reason == "caught_up" else "stopped_at"] = now2.isoformat()

                if meta.get("result_type") == "daily_digest" and not report_created:
                    parts = meta.get("daily_parts")
                    if isinstance(parts, list) and parts:
                        first_part = parts[0]
                        last_part = parts[-1]
                        try:
                            run.covered_from_message_id = int(
                                first_part.get("from_message_id") or run.covered_from_message_id or 0
                            ) or run.covered_from_message_id
                            run.covered_to_message_id = int(
                                last_part.get("to_message_id") or run.covered_to_message_id or 0
                            ) or run.covered_to_message_id
                        except (TypeError, ValueError):
                            pass
                        if first_part.get("from_at"):
                            run.covered_from_at = datetime.fromisoformat(
                                str(first_part["from_at"]).replace("Z", "+00:00")
                            )
                        if last_part.get("to_at"):
                            run.covered_to_at = datetime.fromisoformat(
                                str(last_part["to_at"]).replace("Z", "+00:00")
                            )
                        run.fetched_message_count = sum(
                            int(part.get("message_count") or 0)
                            for part in parts
                            if isinstance(part, dict)
                        )
                        digest_payload, digest_in, digest_out = await _await_with_timeout(
                            _summarize_daily_parts(
                                parts,
                                language,
                                template_key,
                                session=session,
                                chat_uuid=chat.id,
                            ),
                            _SUMMARIZE_TIMEOUT_SECONDS,
                            "daily digest generation",
                        )
                        run.input_token_count = (run.input_token_count or 0) + digest_in
                        run.output_token_count = (run.output_token_count or 0) + digest_out
                        meta["tokens_used"] = int(meta.get("tokens_used") or 0) + digest_in + digest_out
                        digest_md = _build_markdown(digest_payload)
                        report = SummaryReport(
                            summary_run_id=run.id,
                            user_chat_binding_id=binding.id,
                            title=digest_payload["title"],
                            executive_summary=digest_payload.get("executive_summary"),
                            key_points=digest_payload.get("key_points", []),
                            decisions=digest_payload.get("decisions", []),
                            action_items=digest_payload.get("action_items", []),
                            risks=digest_payload.get("risks", []),
                            mentions=digest_payload.get("mentions", []),
                            links=digest_payload.get("links", []),
                            content_markdown=digest_md,
                            language=language,
                        )
                        session.add(report)
                        await session.flush()
                        meta["reports_generated"] = int(meta.get("reports_generated") or 0) + 1
                    meta.pop("daily_parts", None)

                _set_catch_up_meta(cursor, meta)
                if rule is not None:
                    rule.next_run_at = _normal_next_run(rule, binding.auto_summary_enabled, now2)
                _consecutive_cap_hits.pop(str(binding.id), None)
        # next_run_at scheduling only when this was a cursor-advancing run.
        # If we capped out, a real backlog likely remains — reschedule soon so
        # we drain within minutes instead of waiting a full interval. But cap
        # the cascade at `_MAX_FAST_RESCHEDULES`: high-velocity chats that
        # exceed our capacity (msgs/cadence) would otherwise loop forever.
        elif spec.advance_cursor and rule and rule.frequency != "manual":
            bid = str(binding.id)
            if fetch_result.hit_cap:
                cap_count = _consecutive_cap_hits.get(bid, 0) + 1
                _consecutive_cap_hits[bid] = cap_count
                if cap_count <= _MAX_FAST_RESCHEDULES:
                    rule.next_run_at = now2 + timedelta(minutes=2)
                    logger.info(
                        "run hit cap (%d/%d) — fast-rescheduling in 2 min to drain backlog",
                        cap_count, _MAX_FAST_RESCHEDULES,
                    )
                else:
                    delta = frequency_delta(rule.frequency)
                    if delta is not None:
                        rule.next_run_at = now2 + delta
                    logger.warning(
                        "binding %s hit cap %d times in a row — chat exceeds "
                        "drain rate; reverting to %s cadence. Older messages "
                        "will accumulate; user can raise frequency or accept the gap.",
                        bid, cap_count, rule.frequency,
                    )
            else:
                if catch_up_active and cursor is not None:
                    meta = _catch_up_meta(cursor)
                    meta["active"] = False
                    meta["completed_at"] = now2.isoformat()
                    _set_catch_up_meta(cursor, meta)
                _consecutive_cap_hits.pop(bid, None)
                delta = frequency_delta(rule.frequency)
                if delta is not None:
                    rule.next_run_at = now2 + delta

        await session.commit()
        return run, report
    except Exception as exc:  # noqa: BLE001
        error_text = str(exc) or exc.__class__.__name__
        logger.exception("run failed: %s", error_text)
        now2 = datetime.now(timezone.utc)
        run.status = "failed"
        run.finished_at = now2
        run.error_message = error_text[:2000]
        # Tool-loop / LLM failures arrive wrapped so we can still persist
        # the tokens burned before the failure — cost stays visible.
        if isinstance(exc, SummarizeError):
            run.input_token_count = exc.total_in or None
            run.output_token_count = exc.total_out or None
        binding.last_error_at = now2
        binding.last_error_message = error_text[:2000]
        if spec.advance_cursor and catch_up_active and cursor is not None:
            meta = _catch_up_config(cursor)
            meta["failed_batches"] = int(meta.get("failed_batches") or 0) + 1
            meta["tokens_used"] = (
                int(meta.get("tokens_used") or 0)
                + int(run.input_token_count or 0)
                + int(run.output_token_count or 0)
            )
            meta["last_error_at"] = now2.isoformat()
            meta["last_error_message"] = error_text[:500]
            policy = str(meta.get("failure_policy") or "pause")
            should_continue = False
            if policy == "retry_once" and int(meta.get("failed_batches") or 0) <= 1:
                should_continue = True
            elif policy == "skip_batch" and fetch_result is not None and fetch_result.last_raw_id is not None:
                cursor.last_message_id = fetch_result.last_raw_id
                if messages:
                    cursor.last_message_at = messages[-1].date
                should_continue = True

            if should_continue:
                meta["active"] = True
                meta["last_batch_at"] = now2.isoformat()
                _set_catch_up_meta(cursor, meta)
                if rule is not None:
                    rule.next_run_at = _catch_up_next_run_at(meta, now2)
            else:
                meta["active"] = False
                meta["stop_reason"] = "failed"
                meta["stopped_at"] = now2.isoformat()
                _set_catch_up_meta(cursor, meta)
                if rule is not None:
                    rule.next_run_at = _normal_next_run(rule, binding.auto_summary_enabled, now2)
        await session.commit()
        return run, None


async def dispatch_due_runs() -> None:
    """APScheduler entrypoint: start runs for bindings whose `next_run_at` has elapsed."""
    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        q = await session.execute(
            select(UserChatBinding.id, SummaryRule.frequency)
            .join(SummaryRule, SummaryRule.user_chat_binding_id == UserChatBinding.id)
            .join(TelegramChat, TelegramChat.id == UserChatBinding.telegram_chat_id)
            .outerjoin(SummaryCursor, SummaryCursor.user_chat_binding_id == UserChatBinding.id)
            .where(
                UserChatBinding.status == "active",
                TelegramChat.is_active.is_(True),
                (SummaryRule.next_run_at.is_(None)) | (SummaryRule.next_run_at <= now),
                or_(
                    and_(
                        UserChatBinding.auto_summary_enabled.is_(True),
                        SummaryRule.frequency != "manual",
                    ),
                    SummaryCursor.cursor_metadata["catch_up"]["active"].as_boolean().is_(True),
                ),
            )
        )
        due = q.all()

    if not due:
        logger.debug("scheduler: nothing due")
        return

    logger.info("scheduler: %d bindings due", len(due))
    for binding_id, freq in due:
        try:
            async with SessionLocal() as session:
                await execute_run(
                    session=session, binding_id=str(binding_id), trigger_source=f"scheduler:{freq}"
                )
        except RunInProgressError:
            # A manual run (or previous tick's job still wrapping up) owns the
            # lock — skip this tick for that binding, next_run_at stays as-is.
            logger.info("scheduler: binding %s busy, skipping tick", binding_id)
        except Exception:  # noqa: BLE001
            logger.exception("scheduled run failed for binding %s", binding_id)
