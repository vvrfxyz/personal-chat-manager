from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import get_current_account
from ..models import SummaryCursor, SummaryRule, TelegramAccount, TelegramChat, UserChatBinding
from ..schemas import BindingOut, ChatOut, ChatWithBindingOut, SyncChatsOut
from ..security import decrypt
from ..services import telegram as tg

logger = logging.getLogger("app.chats")
router = APIRouter()


from pydantic import BaseModel


class CleanupDeletedOut(BaseModel):
    removed: int
    failed: int
    ids: list[int]


class DialogEntry(BaseModel):
    chat_type: Literal["private", "group", "supergroup", "channel"]
    external_chat_id: int
    access_hash: str | None = None
    title: str
    username: str | None = None
    member_count: int | None = None
    is_deleted: bool = False
    is_bot: bool = False
    unread_count: int = 0
    last_message_at: datetime | None = None


class BulkDeleteItem(BaseModel):
    chat_type: Literal["private", "group", "supergroup", "channel"]
    external_chat_id: int
    access_hash: str | None = None


class BulkDeleteIn(BaseModel):
    items: list[BulkDeleteItem]


class BulkDeleteResult(BaseModel):
    external_chat_id: int
    ok: bool
    error: str | None = None


class BulkDeleteOut(BaseModel):
    removed: int
    failed: int
    results: list[BulkDeleteResult]


@router.get("", response_model=list[ChatWithBindingOut])
async def list_chats(
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> list[ChatWithBindingOut]:
    chats = (
        await session.execute(
            select(TelegramChat)
            .where(TelegramChat.is_active.is_(True))
        )
    ).scalars().all()
    if not chats:
        return []

    bindings_q = await session.execute(
        select(UserChatBinding, SummaryRule, SummaryCursor)
        .outerjoin(SummaryRule, SummaryRule.user_chat_binding_id == UserChatBinding.id)
        .outerjoin(SummaryCursor, SummaryCursor.user_chat_binding_id == UserChatBinding.id)
        .where(UserChatBinding.telegram_account_id == account.id)
    )
    by_chat: dict[str, tuple[UserChatBinding, SummaryRule | None, SummaryCursor | None]] = {
        str(b.telegram_chat_id): (b, r, c) for b, r, c in bindings_q.all()
    }

    out: list[ChatWithBindingOut] = []
    for chat in chats:
        entry = by_chat.get(str(chat.id))
        binding_out: BindingOut | None = None
        if entry:
            b, rule, cursor = entry
            binding_out = BindingOut(
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
                frequency=(rule.frequency if rule else "manual"),
                preferred_language=(rule.preferred_language if rule else "zh-CN"),
                template_key=(rule.template_key if rule else "default"),
                cursor_message_id=(cursor.last_message_id if cursor else None),
                cursor_at=(cursor.last_message_at if cursor else None),
            )
        out.append(ChatWithBindingOut(chat=ChatOut.model_validate(chat), binding=binding_out))

    # Pinned first (most recently pinned on top), then by title.
    def _sort_key(item: ChatWithBindingOut):
        pinned = item.binding.pinned_at if item.binding and item.binding.pinned_at else None
        return (
            0 if pinned else 1,
            -(pinned.timestamp()) if pinned else 0,
            (item.chat.title or "").lower(),
        )

    out.sort(key=_sort_key)
    return out


@router.post("/sync", response_model=SyncChatsOut)
async def sync_chats(
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> SyncChatsOut:
    """Pull the account's dialogs via Telethon and upsert into telegram_chats."""
    logger.info("sync start for account=%s", account.id)
    try:
        session_string = decrypt(account.session_encrypted)
        added = 0
        synced = 0
        seen_external_ids: set[int] = set()
        now = datetime.now(timezone.utc)
        async with tg.build_client(session_string) as client:
            async for dialog in client.iter_dialogs():
                entity = dialog.entity
                chat_type, external_id, access_hash, title, username, member_count = tg.classify_dialog(
                    entity
                )
                if chat_type == "private":
                    # Phase 1: skip DM summaries; UI lists groups/supergroups/channels.
                    continue

                seen_external_ids.add(external_id)
                stmt = (
                    pg_insert(TelegramChat)
                    .values(
                        external_chat_id=external_id,
                        access_hash=str(access_hash) if access_hash is not None else None,
                        title=title,
                        username=username,
                        chat_type=chat_type,
                        member_count=member_count,
                        last_seen_at=now,
                        last_synced_at=now,
                        is_active=True,
                    )
                    .on_conflict_do_update(
                        index_elements=[TelegramChat.external_chat_id],
                        set_={
                            "title": title,
                            "username": username,
                            "chat_type": chat_type,
                            "member_count": member_count,
                            "access_hash": str(access_hash) if access_hash is not None else None,
                            "last_seen_at": now,
                            "last_synced_at": now,
                            "is_active": True,
                        },
                    )
                    .returning(TelegramChat.id, TelegramChat.first_seen_at, TelegramChat.last_seen_at)
                )
                row = (await session.execute(stmt)).one()
                synced += 1
                if abs((row.first_seen_at - row.last_seen_at).total_seconds()) < 2:
                    added += 1

        # Any chat previously marked active but NOT seen this pass → user left / hid it.
        removed: list = []
        if seen_external_ids:
            stale_result = await session.execute(
                update(TelegramChat)
                .where(
                    TelegramChat.is_active.is_(True),
                    TelegramChat.external_chat_id.notin_(seen_external_ids),
                )
                .values(is_active=False, last_synced_at=now)
                .returning(TelegramChat.id, TelegramChat.title)
            )
            removed = list(stale_result.all())
            if removed:
                logger.info("sync: %d chat(s) marked inactive: %s", len(removed), [r.title for r in removed])
                stale_chat_ids = [r.id for r in removed]
                await session.execute(
                    update(UserChatBinding)
                    .where(
                        UserChatBinding.telegram_chat_id.in_(stale_chat_ids),
                        UserChatBinding.telegram_account_id == account.id,
                        UserChatBinding.status == "active",
                    )
                    .values(status="archived", updated_at=now, auto_summary_enabled=False)
                )

        account.last_synced_at = now
        account.last_validated_at = now
        await session.commit()
        logger.info("sync done synced=%d added=%d removed=%d", synced, added, len(removed))
        return SyncChatsOut(synced=synced, added=added)
    except Exception as exc:  # noqa: BLE001
        await session.rollback()
        logger.exception("sync failed")
        raise HTTPException(status_code=502, detail=f"sync failed: {exc}")


@router.get("/dialogs", response_model=list[DialogEntry])
async def list_dialogs(
    chat_type: Literal["private", "group", "supergroup", "channel"] | None = Query(None),
    account: TelegramAccount = Depends(get_current_account),
) -> list[DialogEntry]:
    """Live dialog list straight from Telegram (does NOT touch telegram_chats)."""
    from telethon.tl.types import User as TgUser

    logger.info("list_dialogs type_filter=%s", chat_type)
    session_string = decrypt(account.session_encrypted)
    out: list[DialogEntry] = []
    try:
        async with tg.build_client(session_string) as client:
            async for dialog in client.iter_dialogs():
                entity = dialog.entity
                t, ext_id, access_hash, title, username, member_count = tg.classify_dialog(entity)
                if chat_type and t != chat_type:
                    continue
                is_deleted = isinstance(entity, TgUser) and getattr(entity, "deleted", False)
                is_bot = isinstance(entity, TgUser) and getattr(entity, "bot", False)
                display_title = title or ("Deleted Account" if is_deleted else "—")
                out.append(
                    DialogEntry(
                        chat_type=t,
                        external_chat_id=ext_id,
                        access_hash=str(access_hash) if access_hash is not None else None,
                        title=display_title,
                        username=username,
                        member_count=member_count,
                        is_deleted=is_deleted,
                        is_bot=is_bot,
                        unread_count=dialog.unread_count or 0,
                        last_message_at=dialog.date,
                    )
                )
        logger.info("list_dialogs returned %d entries", len(out))
        return out
    except Exception as exc:  # noqa: BLE001
        logger.exception("list_dialogs failed")
        raise HTTPException(status_code=502, detail=f"list_dialogs failed: {exc}")


@router.post("/bulk-delete", response_model=BulkDeleteOut)
async def bulk_delete(
    payload: BulkDeleteIn,
    session: AsyncSession = Depends(get_session),
    account: TelegramAccount = Depends(get_current_account),
) -> BulkDeleteOut:
    """Leave / delete each peer in the payload. Also archives DB bindings for group/channel."""
    from telethon.tl.types import InputPeerChannel, InputPeerChat, InputPeerUser

    logger.info("bulk_delete items=%d", len(payload.items))
    session_string = decrypt(account.session_encrypted)
    results: list[BulkDeleteResult] = []
    succeeded_ext_ids: list[int] = []

    try:
        async with tg.build_client(session_string) as client:
            for item in payload.items:
                try:
                    if item.chat_type in ("channel", "supergroup"):
                        if item.access_hash is None:
                            raise ValueError("missing access_hash")
                        peer = InputPeerChannel(
                            channel_id=int(item.external_chat_id),
                            access_hash=int(item.access_hash),
                        )
                    elif item.chat_type == "group":
                        peer = InputPeerChat(chat_id=int(item.external_chat_id))
                    elif item.chat_type == "private":
                        if item.access_hash is None:
                            raise ValueError("missing access_hash")
                        peer = InputPeerUser(
                            user_id=int(item.external_chat_id),
                            access_hash=int(item.access_hash),
                        )
                    else:
                        raise ValueError(f"unsupported chat_type {item.chat_type}")

                    await client.delete_dialog(peer)
                    results.append(
                        BulkDeleteResult(external_chat_id=item.external_chat_id, ok=True)
                    )
                    succeeded_ext_ids.append(item.external_chat_id)
                    logger.info("bulk_delete ok: %s %s", item.chat_type, item.external_chat_id)
                except Exception as e:  # noqa: BLE001
                    logger.warning(
                        "bulk_delete failed for %s %s: %s",
                        item.chat_type, item.external_chat_id, e,
                    )
                    results.append(
                        BulkDeleteResult(
                            external_chat_id=item.external_chat_id,
                            ok=False,
                            error=str(e)[:200],
                        )
                    )

        # For any successfully-deleted group/channel that's in our DB, mark inactive and archive bindings
        if succeeded_ext_ids:
            now = datetime.now(timezone.utc)
            archived_chats = (
                await session.execute(
                    update(TelegramChat)
                    .where(TelegramChat.external_chat_id.in_(succeeded_ext_ids))
                    .values(is_active=False, last_synced_at=now)
                    .returning(TelegramChat.id)
                )
            ).all()
            chat_ids = [r.id for r in archived_chats]
            if chat_ids:
                await session.execute(
                    update(UserChatBinding)
                    .where(
                        UserChatBinding.telegram_chat_id.in_(chat_ids),
                        UserChatBinding.telegram_account_id == account.id,
                    )
                    .values(status="archived", auto_summary_enabled=False, updated_at=now)
                )
                await session.commit()

        removed = sum(1 for r in results if r.ok)
        failed = len(results) - removed
        logger.info("bulk_delete done removed=%d failed=%d", removed, failed)
        return BulkDeleteOut(removed=removed, failed=failed, results=results)
    except Exception as exc:  # noqa: BLE001
        await session.rollback()
        logger.exception("bulk_delete failed")
        raise HTTPException(status_code=502, detail=f"bulk_delete failed: {exc}")


@router.post("/cleanup-deleted", response_model=CleanupDeletedOut)
async def cleanup_deleted(
    account: TelegramAccount = Depends(get_current_account),
) -> CleanupDeletedOut:
    """Remove private dialogs whose peer is a Telegram-deleted user ('Deleted Account')."""
    from telethon.tl.types import User as TgUser

    logger.info("cleanup_deleted start for account=%s", account.id)
    session_string = decrypt(account.session_encrypted)
    removed_ids: list[int] = []
    failed = 0
    try:
        async with tg.build_client(session_string) as client:
            dialogs_to_purge = []
            async for dialog in client.iter_dialogs():
                entity = dialog.entity
                if isinstance(entity, TgUser) and getattr(entity, "deleted", False):
                    dialogs_to_purge.append(entity)

            logger.info("cleanup_deleted: found %d deleted-account dialogs", len(dialogs_to_purge))
            for entity in dialogs_to_purge:
                try:
                    await client.delete_dialog(entity)
                    removed_ids.append(int(entity.id))
                except Exception as e:  # noqa: BLE001
                    failed += 1
                    logger.warning("cleanup_deleted: failed for user %s: %s", entity.id, e)
        logger.info("cleanup_deleted done removed=%d failed=%d", len(removed_ids), failed)
        return CleanupDeletedOut(removed=len(removed_ids), failed=failed, ids=removed_ids)
    except Exception as exc:  # noqa: BLE001
        logger.exception("cleanup_deleted failed")
        raise HTTPException(status_code=502, detail=f"cleanup failed: {exc}")
