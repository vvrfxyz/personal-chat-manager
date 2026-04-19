"""One-off: dump the raw text-bearing messages for a given binding's
covered window. Used to ground-truth-check summarizer prompts.

Usage:
    cd backend
    uv run python scripts/dump_window.py <binding_id> <covered_from_iso> <covered_to_iso>
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime

from sqlalchemy import select

from app.db import SessionLocal
from app.models import TelegramAccount, TelegramChat, UserChatBinding
from app.security import decrypt
from app.services import summarizer
from app.services.telegram import build_client


async def main(binding_id: str, after_iso: str, before_iso: str) -> None:
    after_dt = datetime.fromisoformat(after_iso.replace("Z", "+00:00"))
    before_dt = datetime.fromisoformat(before_iso.replace("Z", "+00:00"))

    async with SessionLocal() as session:
        b = (await session.execute(select(UserChatBinding).where(UserChatBinding.id == binding_id))).scalar_one()
        chat = await session.get(TelegramChat, b.telegram_chat_id)
        account = await session.get(TelegramAccount, b.telegram_account_id)

    session_string = decrypt(account.session_encrypted)
    spec = summarizer.FetchSpec(
        after_dt=after_dt,
        before_dt=before_dt,
        limit=2000,
        advance_cursor=False,
    )
    result = await summarizer._fetch_messages(
        session_string=session_string,
        external_chat_id=chat.external_chat_id,
        chat_type=chat.chat_type,
        access_hash=chat.access_hash,
        username=chat.username,
        spec=spec,
    )

    print(f"# Window: {after_iso} → {before_iso}")
    print(f"# Chat: {chat.title}")
    print(f"# Text-bearing messages: {len(result.messages)}")
    print(f"# hit_cap={result.hit_cap}  last_raw_id={result.last_raw_id}")
    print()
    for m in result.messages:
        sender = (m.sender or "?").replace("\n", " ")
        text = m.text.replace("\n", "\\n")
        print(f"[{m.id}] {m.date.isoformat()} | {sender}: {text}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3]))
