"""Telethon helpers.

Single-user Phase 1: we keep at most one persistent `active` row in
`telegram_accounts`. A login flow briefly spins up its own
TelegramClient, issues `send_code_request` / `sign_in`, and stashes the
resulting `StringSession` encrypted in the DB.

Runtime clients (for chat sync / message fetch) are created on demand
via `build_client(session_string)` and should be used inside an
`async with` block.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from telethon import TelegramClient
from telethon.errors import (
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    SessionPasswordNeededError,
)
from telethon.sessions import StringSession
from telethon.tl.types import Channel, Chat, User

from ..config import get_settings

settings = get_settings()


# Advertised to Telegram at login time. Shows up in Settings → Devices.
CLIENT_META = {
    "device_model": "Personal Chat Manager",
    "system_version": "macOS",
    "app_version": "0.1.0",
    "lang_code": "zh",
    "system_lang_code": "zh-CN",
}


def _new_client(session_string: str = "") -> TelegramClient:
    return TelegramClient(
        StringSession(session_string),
        settings.telegram_api_id,
        settings.telegram_api_hash,
        **CLIENT_META,
    )


@asynccontextmanager
async def build_client(session_string: str):
    client = _new_client(session_string)
    await client.connect()
    try:
        yield client
    finally:
        await client.disconnect()


async def send_login_code(phone: str) -> tuple[str, str]:
    """Returns (phone_code_hash, session_string_after_send)."""
    client = _new_client("")
    await client.connect()
    try:
        sent = await client.send_code_request(phone)
    finally:
        session_string = client.session.save()
        await client.disconnect()
    return sent.phone_code_hash, session_string


class TelegramAuthResult:
    def __init__(
        self,
        *,
        session_string: str,
        telegram_user_id: int,
        first_name: str | None,
        last_name: str | None,
        username: str | None,
        phone: str | None,
        password_required: bool = False,
    ) -> None:
        self.session_string = session_string
        self.telegram_user_id = telegram_user_id
        self.first_name = first_name
        self.last_name = last_name
        self.username = username
        self.phone = phone
        self.password_required = password_required

    @property
    def display_name(self) -> str:
        parts = [p for p in (self.first_name, self.last_name) if p]
        return " ".join(parts) or self.username or (self.phone or "Telegram user")


class PasswordRequired(Exception):
    """Raised when 2FA password is needed mid-flow."""


class InvalidCode(Exception):
    pass


class CodeExpired(Exception):
    pass


async def sign_in_with_code(
    *,
    session_string: str,
    phone: str,
    code: str,
    phone_code_hash: str,
    password: str | None = None,
) -> TelegramAuthResult:
    client = _new_client(session_string)
    await client.connect()
    try:
        try:
            me = await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
        except PhoneCodeInvalidError as exc:
            raise InvalidCode() from exc
        except PhoneCodeExpiredError as exc:
            raise CodeExpired() from exc
        except SessionPasswordNeededError:
            if not password:
                raise PasswordRequired()
            me = await client.sign_in(password=password)

        final_session = client.session.save()
        return TelegramAuthResult(
            session_string=final_session,
            telegram_user_id=int(me.id),
            first_name=getattr(me, "first_name", None),
            last_name=getattr(me, "last_name", None),
            username=getattr(me, "username", None),
            phone=getattr(me, "phone", None) or phone,
        )
    finally:
        await client.disconnect()


def classify_dialog(entity: Any) -> tuple[str, int, int | None, str | None, str | None, int | None]:
    """Return (chat_type, external_chat_id, access_hash, title, username, member_count)."""
    if isinstance(entity, Channel):
        chat_type = "channel" if entity.broadcast else "supergroup"
        return (
            chat_type,
            int(entity.id),
            getattr(entity, "access_hash", None),
            getattr(entity, "title", None) or "",
            getattr(entity, "username", None),
            getattr(entity, "participants_count", None),
        )
    if isinstance(entity, Chat):
        return (
            "group",
            int(entity.id),
            None,
            getattr(entity, "title", None) or "",
            None,
            getattr(entity, "participants_count", None),
        )
    if isinstance(entity, User):
        title = " ".join(
            p for p in (getattr(entity, "first_name", None), getattr(entity, "last_name", None)) if p
        ) or (getattr(entity, "username", None) or "Private chat")
        return (
            "private",
            int(entity.id),
            getattr(entity, "access_hash", None),
            title,
            getattr(entity, "username", None),
            None,
        )
    # fallback
    return (
        "group",
        int(getattr(entity, "id", 0)),
        None,
        getattr(entity, "title", None) or "Unknown",
        None,
        None,
    )
