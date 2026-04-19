from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from ..services.templates import list_templates

router = APIRouter()


class TemplateOut(BaseModel):
    id: str
    label: str
    description: str
    system_prompt: str


@router.get("", response_model=list[TemplateOut])
async def get_templates() -> list[TemplateOut]:
    return [TemplateOut(**t) for t in list_templates()]
