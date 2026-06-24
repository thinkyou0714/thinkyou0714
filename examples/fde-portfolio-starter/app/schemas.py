"""Typed request/response contracts.

Keeping the contract explicit (pydantic) is half the FDE job: you turn a vague
"here's some messy text" into a stable, validated interface other systems rely on.
"""
from __future__ import annotations

from enum import Enum
from typing import List

from pydantic import BaseModel, Field


class Priority(str, Enum):
    low = "low"
    normal = "normal"
    high = "high"
    urgent = "urgent"


class ExtractRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Raw, messy input to structure.")


class ActionItem(BaseModel):
    description: str
    due: str | None = Field(default=None, description="Free-text due date if present.")


class ExtractResult(BaseModel):
    summary: str
    entities: List[str] = Field(default_factory=list, description="People, orgs, emails, IDs.")
    action_items: List[ActionItem] = Field(default_factory=list)
    priority: Priority = Priority.normal
    confidence: float = Field(ge=0.0, le=1.0, description="0-1 self-rated confidence.")
    source: str = Field(description="'llm' or 'fallback' — which path produced this.")
