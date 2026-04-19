from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import get_optional_account
from ..models import TelegramAccount, TelegramLoginSession
from ..schemas import AccountOut, SendCodeIn, SendCodeOut, VerifyIn
from ..security import decrypt, encrypt
from ..services import telegram as tg

logger = logging.getLogger("app.auth")
router = APIRouter()


@router.post("/telegram/send-code", response_model=SendCodeOut)
async def send_code(payload: SendCodeIn, session: AsyncSession = Depends(get_session)) -> SendCodeOut:
    phone = payload.phone.strip()
    if not phone.startswith("+") or len(phone) < 7:
        raise HTTPException(status_code=400, detail="phone must be E.164 with leading +")

    # purge any expired login sessions
    await session.execute(
        delete(TelegramLoginSession).where(
            TelegramLoginSession.expires_at < datetime.now(timezone.utc)
        )
    )

    logger.info("send_code: phone=%s", phone)
    try:
        phone_code_hash, tmp_session = await tg.send_login_code(phone)
    except Exception as exc:  # noqa: BLE001
        logger.exception("send_code failed for %s", phone)
        raise HTTPException(status_code=502, detail=f"Telegram send_code failed: {exc}")
    logger.debug("send_code: phone_code_hash=%s...", phone_code_hash[:8])

    login = TelegramLoginSession(
        phone_e164=phone,
        phone_code_hash=phone_code_hash,
        session_encrypted=encrypt(tmp_session),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    session.add(login)
    await session.commit()
    await session.refresh(login)
    return SendCodeOut(login_id=login.id, phone=phone, expires_at=login.expires_at)


@router.post("/telegram/verify", response_model=AccountOut)
async def verify(payload: VerifyIn, session: AsyncSession = Depends(get_session)) -> AccountOut:
    login = await session.get(TelegramLoginSession, payload.login_id)
    if login is None:
        raise HTTPException(status_code=404, detail="login session not found")
    if login.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="login session expired, resend code")

    logger.info("verify: login_id=%s has_password=%s", login.id, bool(payload.password))
    try:
        result = await tg.sign_in_with_code(
            session_string=decrypt(login.session_encrypted),
            phone=login.phone_e164,
            code=payload.code.strip(),
            phone_code_hash=login.phone_code_hash,
            password=payload.password,
        )
    except tg.PasswordRequired:
        logger.info("verify: 2FA password required (login_id=%s)", login.id)
        raise HTTPException(status_code=409, detail="password_required")
    except tg.InvalidCode:
        logger.info("verify: invalid code (login_id=%s)", login.id)
        raise HTTPException(status_code=400, detail="invalid_code")
    except tg.CodeExpired:
        logger.info("verify: code expired (login_id=%s)", login.id)
        raise HTTPException(status_code=410, detail="code_expired")
    except Exception as exc:  # noqa: BLE001
        logger.exception("verify: telethon sign_in failed (login_id=%s)", login.id)
        raise HTTPException(status_code=502, detail=f"Telegram sign_in failed: {exc}")
    logger.info("verify: success telegram_user_id=%s username=%s", result.telegram_user_id, result.username)

    # Replace any prior account so Phase 1 stays single-account.
    existing = (
        await session.execute(select(TelegramAccount).where(TelegramAccount.status == "active"))
    ).scalars().all()
    for acc in existing:
        acc.status = "disconnected"
        acc.disconnected_at = datetime.now(timezone.utc)

    acc = TelegramAccount(
        telegram_user_id=result.telegram_user_id,
        phone_e164=result.phone,
        account_display_name=result.display_name,
        account_username=result.username,
        session_encrypted=encrypt(result.session_string),
        status="active",
        last_validated_at=datetime.now(timezone.utc),
    )
    session.add(acc)

    # login session consumed
    await session.delete(login)
    await session.commit()
    await session.refresh(acc)
    return AccountOut.model_validate(acc)


@router.get("/me", response_model=AccountOut | None)
async def me(account: TelegramAccount | None = Depends(get_optional_account)) -> AccountOut | None:
    if account is None:
        return None
    return AccountOut.model_validate(account)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(session: AsyncSession = Depends(get_session)) -> None:
    existing = (
        await session.execute(select(TelegramAccount).where(TelegramAccount.status == "active"))
    ).scalars().all()
    for acc in existing:
        acc.status = "disconnected"
        acc.disconnected_at = datetime.now(timezone.utc)
    await session.commit()
