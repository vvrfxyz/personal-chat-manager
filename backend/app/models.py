from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ENUM, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _pg_enum(name: str, *values: str) -> ENUM:
    # `create_type=False` because the enum type already exists in the DB.
    # Values must be enumerated so SQLAlchemy can round-trip values without LookupError.
    return ENUM(*values, name=name, create_type=False, native_enum=True)


TelegramAccountStatus = _pg_enum(
    "telegram_account_status",
    "pending", "active", "reauth_required", "disconnected", "disabled",
)
ChatTypeEnum = _pg_enum("chat_type", "private", "group", "supergroup", "channel")
BindingStatusEnum = _pg_enum(
    "binding_status", "active", "paused", "reauth_required", "archived"
)
SummaryFrequencyEnum = _pg_enum(
    "summary_frequency", "manual", "hourly", "every_6h", "every_12h", "daily"
)
SummaryRunStatusEnum = _pg_enum(
    "summary_run_status",
    "pending", "running", "success", "failed", "skipped", "cancelled",
)

# Shorthand: every datetime column in this schema is timestamptz.
TSTZ = DateTime(timezone=True)


class TelegramAccount(Base):
    __tablename__ = "telegram_accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    telegram_user_id: Mapped[int | None] = mapped_column(BigInteger)
    phone_e164: Mapped[str | None] = mapped_column(Text)
    account_display_name: Mapped[str | None] = mapped_column(Text)
    account_username: Mapped[str | None] = mapped_column(Text)
    session_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(TelegramAccountStatus, nullable=False, server_default="pending")
    last_synced_at: Mapped[datetime | None] = mapped_column(TSTZ)
    last_validated_at: Mapped[datetime | None] = mapped_column(TSTZ)
    reauth_required_at: Mapped[datetime | None] = mapped_column(TSTZ)
    disconnected_at: Mapped[datetime | None] = mapped_column(TSTZ)
    created_at: Mapped[datetime] = mapped_column(TSTZ, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TSTZ, server_default=func.now(), nullable=False)


class TelegramChat(Base):
    __tablename__ = "telegram_chats"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    external_chat_id: Mapped[int] = mapped_column(BigInteger, nullable=False, unique=True)
    access_hash: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    username: Mapped[str | None] = mapped_column(Text)
    chat_type: Mapped[str] = mapped_column(ChatTypeEnum, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    member_count: Mapped[int | None] = mapped_column(Integer)
    first_seen_at: Mapped[datetime] = mapped_column(TSTZ, server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(TSTZ, server_default=func.now(), nullable=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(TSTZ)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    chat_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, server_default="{}")


class UserChatBinding(Base):
    __tablename__ = "user_chat_bindings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    telegram_account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("telegram_accounts.id", ondelete="CASCADE"), nullable=False)
    telegram_chat_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("telegram_chats.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(BindingStatusEnum, nullable=False, server_default="active")
    auto_summary_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    first_summary_mode: Mapped[str] = mapped_column(Text, nullable=False, server_default="from_now")
    first_summary_anchor_at: Mapped[datetime | None] = mapped_column(TSTZ)
    last_run_at: Mapped[datetime | None] = mapped_column(TSTZ)
    last_success_at: Mapped[datetime | None] = mapped_column(TSTZ)
    last_error_at: Mapped[datetime | None] = mapped_column(TSTZ)
    last_error_message: Mapped[str | None] = mapped_column(Text)
    pinned_at: Mapped[datetime | None] = mapped_column(TSTZ)
    created_at: Mapped[datetime] = mapped_column(TSTZ, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TSTZ, server_default=func.now(), nullable=False)

    chat: Mapped[TelegramChat] = relationship(lazy="joined", foreign_keys=[telegram_chat_id])
    rule: Mapped["SummaryRule | None"] = relationship(back_populates="binding", uselist=False, lazy="joined")
    cursor: Mapped["SummaryCursor | None"] = relationship(back_populates="binding", uselist=False, lazy="joined")


class SummaryRule(Base):
    __tablename__ = "summary_rules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_chat_binding_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("user_chat_bindings.id", ondelete="CASCADE"), nullable=False, unique=True)
    frequency: Mapped[str] = mapped_column(SummaryFrequencyEnum, nullable=False, server_default="manual")
    preferred_language: Mapped[str] = mapped_column(Text, nullable=False, server_default="zh-CN")
    template_key: Mapped[str] = mapped_column(Text, nullable=False, server_default="default")
    custom_prompt: Mapped[str | None] = mapped_column(Text)
    min_message_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    max_messages_per_run: Mapped[int] = mapped_column(Integer, nullable=False, server_default="500")
    only_run_when_new_messages: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    next_run_at: Mapped[datetime | None] = mapped_column(TSTZ)
    created_at: Mapped[datetime] = mapped_column(TSTZ, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TSTZ, server_default=func.now(), nullable=False)

    binding: Mapped[UserChatBinding] = relationship(back_populates="rule")


class SummaryCursor(Base):
    __tablename__ = "summary_cursors"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_chat_binding_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("user_chat_bindings.id", ondelete="CASCADE"), nullable=False, unique=True)
    last_message_id: Mapped[int | None] = mapped_column(BigInteger)
    last_message_at: Mapped[datetime | None] = mapped_column(TSTZ)
    last_message_grouped_id: Mapped[int | None] = mapped_column(BigInteger)
    cursor_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")
    updated_at: Mapped[datetime] = mapped_column(TSTZ, server_default=func.now(), nullable=False)

    binding: Mapped[UserChatBinding] = relationship(back_populates="cursor")


class SummaryRun(Base):
    __tablename__ = "summary_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    telegram_account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("telegram_accounts.id", ondelete="CASCADE"), nullable=False)
    telegram_chat_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("telegram_chats.id", ondelete="CASCADE"), nullable=False)
    user_chat_binding_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("user_chat_bindings.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(SummaryRunStatusEnum, nullable=False, server_default="pending")
    trigger_source: Mapped[str] = mapped_column(Text, nullable=False, server_default="scheduler")
    started_at: Mapped[datetime | None] = mapped_column(TSTZ)
    finished_at: Mapped[datetime | None] = mapped_column(TSTZ)
    covered_from_message_id: Mapped[int | None] = mapped_column(BigInteger)
    covered_to_message_id: Mapped[int | None] = mapped_column(BigInteger)
    covered_from_at: Mapped[datetime | None] = mapped_column(TSTZ)
    covered_to_at: Mapped[datetime | None] = mapped_column(TSTZ)
    fetched_message_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    input_token_count: Mapped[int | None] = mapped_column(Integer)
    output_token_count: Mapped[int | None] = mapped_column(Integer)
    model_name: Mapped[str | None] = mapped_column(Text)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    error_code: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TSTZ, server_default=func.now(), nullable=False)


class SummaryReport(Base):
    __tablename__ = "summary_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    summary_run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("summary_runs.id", ondelete="CASCADE"), nullable=False, unique=True)
    user_chat_binding_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("user_chat_bindings.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    executive_summary: Mapped[str | None] = mapped_column(Text)
    key_points: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, server_default="[]")
    decisions: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, server_default="[]")
    action_items: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, server_default="[]")
    risks: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, server_default="[]")
    mentions: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, server_default="[]")
    links: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, server_default="[]")
    content_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str] = mapped_column(Text, nullable=False, server_default="zh-CN")
    generated_at: Mapped[datetime] = mapped_column(TSTZ, server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TSTZ, server_default=func.now(), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(TSTZ)


class TelegramLoginSession(Base):
    __tablename__ = "telegram_login_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    phone_e164: Mapped[str] = mapped_column(Text, nullable=False)
    phone_code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    session_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TSTZ, server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(TSTZ, nullable=False)


class TelegramMessage(Base):
    __tablename__ = "telegram_messages"

    telegram_chat_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("telegram_chats.id", ondelete="CASCADE"),
        primary_key=True,
    )
    external_msg_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    date: Mapped[datetime] = mapped_column(TSTZ, nullable=False)
    sender_id: Mapped[int | None] = mapped_column(BigInteger)
    sender_name: Mapped[str | None] = mapped_column(Text)
    reply_to_msg_id: Mapped[int | None] = mapped_column(BigInteger)
    text: Mapped[str | None] = mapped_column(Text)
    raw_meta: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(TSTZ, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TSTZ, server_default=func.now(), nullable=False)
