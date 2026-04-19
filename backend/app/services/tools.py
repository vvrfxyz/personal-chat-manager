"""LLM-callable tools for cross-window reply-chain traversal.

Three tools scoped to the current binding's chat:
  - get_message(msg_id)
  - get_reply_chain(msg_id, max_depth)
  - search_messages(query, limit, from_ts?, to_ts?)

All three take `session` + `chat_uuid` as closure context (injected by the
caller, never exposed in the function schema) so the LLM cannot read
messages from any chat it hasn't been invoked for. Payloads are kept
compact: text is truncated per-tool to avoid context bloat inside the
tool loop (see plan M3 caps).
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import TelegramMessage

logger = logging.getLogger("app.tools")

# Per-tool payload caps. Conservative on purpose — the tool loop may run
# up to `max_tool_iterations` times and each round-trip stays in `convo`
# forever, so a lenient cap here pushes the prompt past the model's
# context window in unhappy cases.
_MAX_DEPTH = 5
_GET_MESSAGE_TEXT_CAP = 500
_CHAIN_TEXT_CAP = 120
_SNIPPET_TEXT_CAP = 80
_SEARCH_LIMIT_CAP = 20
_SEARCH_QUERY_MIN = 2
_SEARCH_QUERY_MAX = 100


def _truncate(s: str | None, n: int) -> tuple[str | None, bool]:
    if s is None:
        return None, False
    if len(s) > n:
        return s[:n], True
    return s, False


def _compact_row(m: TelegramMessage, text_cap: int) -> dict[str, Any]:
    t, truncated = _truncate(m.text, text_cap)
    return {
        "id": m.external_msg_id,
        "date": m.date.isoformat(),
        "sender": m.sender_name,
        "reply_to_msg_id": m.reply_to_msg_id,
        "text": t if t is not None else "[media]",
        "truncated": truncated,
    }


def _parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _make_snippet(full: str, query: str, cap: int) -> str:
    idx = full.lower().find(query.lower())
    if idx < 0:
        return full[:cap]
    start = max(0, idx - cap // 4)
    end = start + cap
    snippet = full[start:end]
    if start > 0:
        snippet = "…" + snippet
    return snippet


async def get_message(
    *,
    session: AsyncSession,
    chat_uuid: uuid.UUID,
    msg_id: int,
) -> dict[str, Any]:
    row = await session.get(TelegramMessage, (chat_uuid, int(msg_id)))
    if row is None:
        return {"status": "not_in_db", "msg_id": int(msg_id)}
    return _compact_row(row, _GET_MESSAGE_TEXT_CAP)


async def get_reply_chain(
    *,
    session: AsyncSession,
    chat_uuid: uuid.UUID,
    msg_id: int,
    max_depth: int = 3,
) -> dict[str, Any]:
    depth_limit = min(max(int(max_depth), 1), _MAX_DEPTH)
    chain: list[dict[str, Any]] = []
    broken_at: int | None = None
    current_id: int | None = int(msg_id)
    for _ in range(depth_limit):
        if current_id is None:
            break
        row = await session.get(TelegramMessage, (chat_uuid, current_id))
        if row is None:
            broken_at = current_id
            break
        chain.append(_compact_row(row, _CHAIN_TEXT_CAP))
        current_id = row.reply_to_msg_id
    # hit_limit = we stopped because of depth, not because chain ended.
    hit_limit = (
        len(chain) == depth_limit
        and broken_at is None
        and current_id is not None
    )
    return {"chain": chain, "hit_limit": hit_limit, "broken_at": broken_at}


async def search_messages(
    *,
    session: AsyncSession,
    chat_uuid: uuid.UUID,
    query: str,
    limit: int = 10,
    from_ts: str | None = None,
    to_ts: str | None = None,
) -> dict[str, Any]:
    q = (query or "").strip()
    if len(q) < _SEARCH_QUERY_MIN:
        return {"matches": [], "total_matched": 0, "more": False}
    q = q[:_SEARCH_QUERY_MAX]
    n = min(max(int(limit), 1), _SEARCH_LIMIT_CAP)

    stmt = (
        select(TelegramMessage)
        .where(
            TelegramMessage.telegram_chat_id == chat_uuid,
            TelegramMessage.text.is_not(None),
            TelegramMessage.text.ilike(f"%{q}%"),
        )
        .order_by(TelegramMessage.date.desc())
    )
    if from_ts:
        stmt = stmt.where(TelegramMessage.date >= _parse_iso(from_ts))
    if to_ts:
        stmt = stmt.where(TelegramMessage.date <= _parse_iso(to_ts))

    # LIMIT n+1 to detect "more without a separate COUNT(*) query.
    rows = (await session.execute(stmt.limit(n + 1))).scalars().all()
    more = len(rows) > n
    rows = rows[:n]

    matches = [
        {
            "id": m.external_msg_id,
            "date": m.date.isoformat(),
            "sender": m.sender_name,
            "snippet": _make_snippet(m.text or "", q, _SNIPPET_TEXT_CAP),
        }
        for m in rows
    ]
    return {"matches": matches, "total_matched": len(matches), "more": more}


TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_message",
            "description": (
                "Fetch a single message by its Telegram id, scoped to this chat."
            ),
            "parameters": {
                "type": "object",
                "required": ["msg_id"],
                "additionalProperties": False,
                "properties": {
                    "msg_id": {"type": "integer"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_reply_chain",
            "description": (
                "Walk backward along reply_to_msg_id up to max_depth levels, "
                "returning the current message and its ancestors. Use when "
                "the window references a msg id (↪N) not in the provided list."
            ),
            "parameters": {
                "type": "object",
                "required": ["msg_id"],
                "additionalProperties": False,
                "properties": {
                    "msg_id": {"type": "integer"},
                    "max_depth": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 5,
                        "default": 3,
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_messages",
            "description": (
                "Substring search (case-insensitive) within this chat. "
                "Use sparingly — only when the window references "
                "'that thing we discussed before' without enough context."
            ),
            "parameters": {
                "type": "object",
                "required": ["query"],
                "additionalProperties": False,
                "properties": {
                    "query": {
                        "type": "string",
                        "minLength": 2,
                        "maxLength": 100,
                    },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 20,
                        "default": 10,
                    },
                    "from_ts": {
                        "type": "string",
                        "description": "ISO 8601 lower bound (inclusive)",
                    },
                    "to_ts": {
                        "type": "string",
                        "description": "ISO 8601 upper bound (inclusive)",
                    },
                },
            },
        },
    },
]


async def dispatch_tool(
    name: str,
    args: dict[str, Any],
    *,
    session: AsyncSession,
    chat_uuid: uuid.UUID,
) -> dict[str, Any]:
    try:
        if name == "get_message":
            return await get_message(
                session=session, chat_uuid=chat_uuid,
                msg_id=int(args["msg_id"]),
            )
        if name == "get_reply_chain":
            return await get_reply_chain(
                session=session, chat_uuid=chat_uuid,
                msg_id=int(args["msg_id"]),
                max_depth=int(args.get("max_depth", 3)),
            )
        if name == "search_messages":
            return await search_messages(
                session=session, chat_uuid=chat_uuid,
                query=str(args.get("query", "")),
                limit=int(args.get("limit", 10)),
                from_ts=args.get("from_ts"),
                to_ts=args.get("to_ts"),
            )
        return {"status": "error", "reason": f"unknown_tool:{name}"}
    except (KeyError, ValueError, TypeError) as exc:
        return {
            "status": "error",
            "reason": f"bad_args:{type(exc).__name__}:{str(exc)[:100]}",
        }
    except Exception as exc:  # noqa: BLE001
        logger.exception("tool %s failed", name)
        return {
            "status": "error",
            "reason": f"{type(exc).__name__}:{str(exc)[:100]}",
        }
