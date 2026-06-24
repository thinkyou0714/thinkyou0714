"""The extraction agent.

Design choice (the kind of thing an FDE interviewer probes):
- If ANTHROPIC_API_KEY is set, we ask Claude to structure the text and validate the
  JSON against our schema.
- If not, we fall back to a deterministic heuristic so the service — and its evals —
  run with no secrets. Being able to test the pipeline offline is what lets you catch
  regressions before they hit a customer.
"""
from __future__ import annotations

import json
import os
import re

from .schemas import ActionItem, ExtractResult, Priority

# Most capable model is "claude-opus-4-8"; "claude-sonnet-4-6" is the balanced default.
DEFAULT_MODEL = os.environ.get("MODEL", "claude-sonnet-4-6")

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_URGENT_WORDS = ("至急", "緊急", "urgent", "asap", "今すぐ", "本日中")
_HIGH_WORDS = ("明日", "急ぎ", "優先", "deadline", "締切", "期限")
_ACTION_WORDS = ("依頼", "お願い", "対応", "確認", "返信", "見積", "review", "send", "fix", "follow up")
_DUE_RE = re.compile(r"(明日|今日|本日|来週|\d{1,2}/\d{1,2}|\d{1,2}月\d{1,2}日|by \w+)")
# Crude negation guard so "急ぎではありません" doesn't escalate. The LLM path handles
# nuance; this keeps the offline fallback honest enough to test against.
_NEGATIONS = ("ありません", "ではない", "不要", "なし", "ではなく")

SYSTEM_PROMPT = (
    "You extract structure from messy business text. Return ONLY a JSON object with keys: "
    "summary (string), entities (string[]), action_items (array of {description, due}), "
    "priority (one of low|normal|high|urgent), confidence (0-1 number). No prose."
)


def _detect_priority(text: str) -> Priority:
    low = text.lower()

    def present(words: tuple[str, ...]) -> bool:
        for w in words:
            i = text.find(w)
            if i == -1:
                if w.isascii() and w in low:  # english keyword, case-insensitive
                    return True
                continue
            tail = text[i + len(w): i + len(w) + 10]
            if not any(n in tail for n in _NEGATIONS):  # skip negated mentions
                return True
        return False

    if present(_URGENT_WORDS):
        return Priority.urgent
    if present(_HIGH_WORDS):
        return Priority.high
    return Priority.normal


def _fallback(text: str) -> ExtractResult:
    """Deterministic, dependency-free extraction. Good enough to test the contract."""
    entities = _EMAIL_RE.findall(text)
    actions: list[ActionItem] = []
    for raw in re.split(r"[。\n.;]", text):
        seg = raw.strip()
        if not seg:
            continue
        low = seg.lower()
        if any(w in seg or w in low for w in _ACTION_WORDS):
            due_m = _DUE_RE.search(seg)
            actions.append(ActionItem(description=seg, due=due_m.group(0) if due_m else None))
    summary = text.strip().replace("\n", " ")
    if len(summary) > 140:
        summary = summary[:137] + "..."
    confidence = 0.55 if actions or entities else 0.4
    return ExtractResult(
        summary=summary,
        entities=entities,
        action_items=actions,
        priority=_detect_priority(text),
        confidence=confidence,
        source="fallback",
    )


def _llm(text: str) -> ExtractResult:
    import anthropic  # imported lazily so the service runs without the dep when unused

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=DEFAULT_MODEL,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": text}],
    )
    payload = "".join(block.text for block in resp.content if getattr(block, "type", "") == "text")
    data = json.loads(payload)
    data.setdefault("confidence", 0.7)
    data["source"] = "llm"
    # Re-validate the model's output against our schema before trusting it.
    return ExtractResult.model_validate(data)


def extract(text: str) -> ExtractResult:
    """Structure messy text. Uses Claude when a key is present, else a safe fallback."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            return _llm(text)
        except Exception:  # noqa: BLE001 — never let a customer request 500 on LLM hiccups
            result = _fallback(text)
            result.summary = "[llm-failed→fallback] " + result.summary
            return result
    return _fallback(text)
