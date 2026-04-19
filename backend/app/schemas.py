from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ChatTypeLiteral = Literal["private", "group", "supergroup", "channel"]
FrequencyLiteral = Literal["manual", "hourly", "every_6h", "every_12h", "daily"]
FirstSummaryModeLiteral = Literal["from_now", "last_24h", "last_7d"]
RunStatusLiteral = Literal["pending", "running", "success", "failed", "skipped", "cancelled"]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Auth ----------


class SendCodeIn(BaseModel):
    phone: str = Field(..., description="E.164 phone with + prefix")


class SendCodeOut(BaseModel):
    login_id: UUID
    phone: str
    expires_at: datetime


class VerifyIn(BaseModel):
    login_id: UUID
    code: str
    password: str | None = None


class AccountOut(ORMModel):
    id: UUID
    telegram_user_id: int | None
    phone_e164: str | None
    account_display_name: str | None
    account_username: str | None
    status: str
    last_synced_at: datetime | None
    last_validated_at: datetime | None
    created_at: datetime


# ---------- Chats ----------


class ChatOut(ORMModel):
    id: UUID
    external_chat_id: int
    title: str
    username: str | None
    chat_type: ChatTypeLiteral
    member_count: int | None
    description: str | None
    is_active: bool
    first_seen_at: datetime
    last_synced_at: datetime | None


class ChatWithBindingOut(BaseModel):
    chat: ChatOut
    binding: BindingOut | None


class SyncChatsOut(BaseModel):
    synced: int
    added: int


# ---------- Bindings ----------


class BindingOut(ORMModel):
    id: UUID
    telegram_chat_id: UUID
    status: str
    auto_summary_enabled: bool
    first_summary_mode: str
    first_summary_anchor_at: datetime | None
    last_run_at: datetime | None
    last_success_at: datetime | None
    last_error_at: datetime | None
    last_error_message: str | None
    pinned_at: datetime | None = None
    frequency: FrequencyLiteral = "manual"
    preferred_language: str = "zh-CN"
    template_key: str = "default"
    cursor_message_id: int | None = None
    cursor_at: datetime | None = None


class BindingPatchIn(BaseModel):
    auto_summary_enabled: bool | None = None
    frequency: FrequencyLiteral | None = None
    preferred_language: str | None = None
    template_key: str | None = None
    first_summary_mode: FirstSummaryModeLiteral | None = None
    pinned: bool | None = None


# ---------- Reports ----------


class ReportOut(ORMModel):
    id: UUID
    summary_run_id: UUID
    user_chat_binding_id: UUID
    title: str
    executive_summary: str | None
    key_points: list[Any]
    decisions: list[Any]
    action_items: list[Any]
    risks: list[Any]
    mentions: list[Any]
    links: list[Any]
    content_markdown: str
    language: str
    generated_at: datetime
    created_at: datetime
    read_at: datetime | None = None
    # Time window of the source messages this report summarizes. Sourced from
    # the associated SummaryRun — null for older reports written before the
    # run bookkeeping existed, or for zero-message runs.
    covered_from_at: datetime | None = None
    covered_to_at: datetime | None = None


class RunOut(ORMModel):
    id: UUID
    user_chat_binding_id: UUID
    status: RunStatusLiteral
    trigger_source: str
    started_at: datetime | None
    finished_at: datetime | None
    fetched_message_count: int
    input_token_count: int | None
    output_token_count: int | None
    model_name: str | None
    error_code: str | None
    error_message: str | None
    created_at: datetime


class RunNowOut(BaseModel):
    run: RunOut
    report: ReportOut | None


# forward refs for ChatWithBindingOut
ChatWithBindingOut.model_rebuild()
