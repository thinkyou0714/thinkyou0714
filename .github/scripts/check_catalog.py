#!/usr/bin/env python3
"""Validate the agmsg ideas catalog (docs/agmsg-ideas.md) — stdlib only.

The catalog is an append-only, numbered backlog. A dropped, duplicated, or
out-of-order number breaks cross-references like "catalog #144", so CI checks
that the numbered items form a contiguous 1..N run and each carries a recognized
status tag. Items inside ``` code fences are ignored.

Exit 1 on any gap, duplicate, out-of-order number, or unknown/missing tag.
"""
from __future__ import annotations

import re
import sys
from collections.abc import Iterator

CATALOG = "docs/agmsg-ideas.md"
# A catalog item starts a line: "<n>. **[tag]** ...".
ITEM = re.compile(r"^(\d+)\.\s+\*\*\[([a-z-]+)\]\*\*")
KNOWN_TAGS = {"done", "rec", "roadmap", "assessed", "verified", "hold", "human-settings"}


def iter_items(text: str) -> Iterator[tuple[int, str]]:
    """Yield (number, tag) for each catalog item outside ``` code fences."""
    in_fence = False
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = ITEM.match(line)
        if m:
            yield int(m.group(1)), m.group(2)


def check(text: str) -> list[str]:
    errors: list[str] = []
    numbers: list[int] = []
    for n, tag in iter_items(text):
        numbers.append(n)
        if tag not in KNOWN_TAGS:
            known = ", ".join(sorted(KNOWN_TAGS))
            errors.append(f"item {n}: unknown tag [{tag}] (known: {known})")
    if not numbers:
        return [f"{CATALOG}: no numbered items found"]
    for idx, got in enumerate(numbers):
        if got != idx + 1:
            errors.append(f"numbering not contiguous: expected {idx + 1}, found {got}")
            break
    return errors


def main() -> int:
    try:
        with open(CATALOG, encoding="utf-8") as fh:
            text = fh.read()
    except FileNotFoundError:
        print(f"::error::{CATALOG} not found")
        return 1
    errors = check(text)
    for e in errors:
        print(f"::error::{e}")
    count = sum(1 for _ in iter_items(text))
    print(f"checked {CATALOG}: {count} numbered item(s), {len(errors)} problem(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
