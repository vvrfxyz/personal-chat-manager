from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_session
from .models import TelegramAccount


async def get_current_account(
    session: AsyncSession = Depends(get_session),
) -> TelegramAccount:
    """Phase 1 single-user: return the one active account or 401."""
    result = await session.execute(
        select(TelegramAccount).where(TelegramAccount.status == "active").limit(1)
    )
    account = result.scalar_one_or_none()
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No Telegram account bound. Login first at /api/auth/telegram/send-code.",
        )
    return account


async def get_optional_account(
    session: AsyncSession = Depends(get_session),
) -> TelegramAccount | None:
    result = await session.execute(
        select(TelegramAccount).where(TelegramAccount.status == "active").limit(1)
    )
    return result.scalar_one_or_none()
