"""Eval harness — the FDE differentiator.

This is a tiny golden-set regression suite that runs the *offline* path (no API key),
so it works in CI with zero secrets. Grow GOLDEN to 30+ cases and report metrics in the
README. The point: catch regressions before a customer does.

Run:  pytest -q   (from the portfolio-starter/ directory)
"""
from __future__ import annotations

import pytest

from app.agent import extract
from app.schemas import Priority


@pytest.fixture(autouse=True)
def _force_offline(monkeypatch):
    # Force the deterministic path so evals are reproducible without secrets.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


# (input, expected_priority, must_contain_entity, expects_action)
GOLDEN = [
    ("至急: 田中様(tanaka@example.com)から見積もり依頼。明日まで。", Priority.urgent, "tanaka@example.com", True),
    ("Please review the PR by Friday. asap.", Priority.urgent, None, True),
    ("来週の定例の議事メモを共有します。特に急ぎではありません。", Priority.normal, None, False),
    ("明日までに請求書の確認をお願いします。", Priority.high, None, True),
    ("FYI: 倉庫の在庫レポート。アクションは不要。", Priority.normal, None, False),
]


@pytest.mark.parametrize("text,prio,entity,has_action", GOLDEN)
def test_contract_and_extraction(text, prio, entity, has_action):
    r = extract(text)
    # Contract holds.
    assert r.source == "fallback"
    assert 0.0 <= r.confidence <= 1.0
    assert isinstance(r.summary, str) and r.summary
    # Priority classification.
    assert r.priority == prio
    # Entity capture (when expected).
    if entity is not None:
        assert entity in r.entities
    # Action detection.
    assert bool(r.action_items) == has_action


def test_priority_accuracy_threshold():
    correct = sum(1 for text, prio, *_ in GOLDEN if extract(text).priority == prio)
    accuracy = correct / len(GOLDEN)
    # Regression gate: keep priority classification at/above this bar.
    assert accuracy >= 0.8, f"priority accuracy regressed to {accuracy:.0%}"
