#!/usr/bin/env python3
"""Offline markdown link + anchor checker — no third-party Actions required.

This repo enforces an Actions allow-list (only GitHub-authored / explicitly
allowed actions), so the link check is done here in pure stdlib Python instead
of a marketplace action.

Checks, for every committed `*.md`:
  * relative links point to a file that exists,
  * any `#fragment` resolves to a GitHub-style heading anchor in the target, and
  * every image carries non-empty alt text (accessibility).
External (http/https/mailto/tel) links are skipped, as are links/images written inside
code spans or ``` fences (so documenting `![](x)` doesn't trip the check).
Exit 1 if any problem is found.
"""
from __future__ import annotations

import os
import re
import sys

# [text](target) but not images ![alt](src); target captured up to first ')'.
LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)]+)\)")
# Images ![alt](src); GitHub-rendered images must carry alt text for accessibility.
IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
# Inline code span; blanked out (with fenced blocks) before scanning for links/images.
INLINE_CODE = re.compile(r"`[^`]*`")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
# github-slugger removes this punctuation (keeps word chars, spaces, "-", "_");
# spaces become hyphens below. ASCII set covers this repo's headings.
SPECIAL = re.compile(r"""[!"#$%&'()*+,./:;<=>?@\[\\\]^`{|}~]""")


def slugify(text: str) -> str:
    """Approximate GitHub's heading-anchor algorithm (github-slugger)."""
    return SPECIAL.sub("", text.strip().lower()).replace(" ", "-")


def anchors_for(path: str) -> set[str]:
    seen: dict[str, int] = {}
    out: set[str] = set()
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return out
    in_fence = False
    for line in lines:
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = HEADING.match(line)
        if not m:
            continue
        base = slugify(m.group(2))
        n = seen.get(base, 0)
        seen[base] = n + 1
        out.add(base if n == 0 else f"{base}-{n}")
    return out


def strip_code(text: str) -> str:
    """Blank out fenced blocks and inline code so examples aren't scanned as links."""
    lines: list[str] = []
    in_fence = False
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            lines.append("")
            continue
        lines.append("" if in_fence else INLINE_CODE.sub("", line))
    return "\n".join(lines)


def main() -> int:
    md_files: list[str] = []
    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules")]
        md_files += [os.path.join(root, f) for f in files if f.endswith(".md")]

    errors: list[str] = []
    for md in sorted(md_files):
        base_dir = os.path.dirname(md)
        with open(md, encoding="utf-8") as fh:
            text = fh.read()
        scan = strip_code(text)
        for raw in LINK.findall(scan):
            target = raw.strip()
            if target.startswith("<") and ">" in target:
                target = target[1 : target.index(">")]
            target = target.split(" ", 1)[0]  # drop optional "title"
            if not target or target.startswith(
                ("http://", "https://", "mailto:", "tel:")
            ):
                continue
            if target.startswith("#"):
                frag = target[1:]
                if frag and frag not in anchors_for(md):
                    errors.append(f"{md}: missing same-file anchor #{frag}")
                continue
            path_part, _, frag = target.partition("#")
            dest = os.path.normpath(os.path.join(base_dir, path_part))
            if not os.path.exists(dest):
                errors.append(f"{md}: broken link -> {target} (no {dest})")
            elif frag and dest.endswith(".md") and frag not in anchors_for(dest):
                errors.append(f"{md}: missing anchor {path_part}#{frag}")
        for alt, src in IMAGE.findall(scan):
            if not alt.strip():
                errors.append(f"{md}: image missing alt text -> {src.strip()}")

    for e in errors:
        print(f"::error::{e}")
    print(f"checked {len(md_files)} markdown file(s), {len(errors)} problem(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
