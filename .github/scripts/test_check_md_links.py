#!/usr/bin/env python3
"""Unit tests for check_md_links.py.

Run locally or in CI (lint.yml):
    python3 -m unittest discover -s .github/scripts -p 'test_*.py'

These lock down the GitHub heading-anchor slug algorithm (the part most likely
to silently drift from GitHub's renderer) plus the link/anchor detection.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_md_links as c  # noqa: E402


class TestSlugify(unittest.TestCase):
    def test_basic_lowercase_and_spaces(self):
        self.assertEqual(c.slugify("Hello World"), "hello-world")

    def test_real_goal_heading(self):
        # The exact cross-link the round-2 lint fix turned on.
        self.assertEqual(
            c.slugify("4. `/goal` handoff template"),
            "4-goal-handoff-template",
        )

    def test_keeps_underscore_and_hyphen(self):
        self.assertEqual(c.slugify("snake_case-kept"), "snake_case-kept")

    def test_spaces_not_collapsed(self):
        # github-slugger maps each space to one hyphen; it does not collapse runs.
        self.assertEqual(c.slugify("a  b"), "a--b")


class TestAnchors(unittest.TestCase):
    def _write(self, text):
        fd, path = tempfile.mkstemp(suffix=".md")
        os.close(fd)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        self.addCleanup(os.remove, path)
        return path

    def test_headings_become_anchors(self):
        anchors = c.anchors_for(self._write("# Title\n\n## Sub Section\n"))
        self.assertIn("title", anchors)
        self.assertIn("sub-section", anchors)

    def test_duplicate_headings_get_numeric_suffixes(self):
        anchors = c.anchors_for(self._write("# Dup\n# Dup\n# Dup\n"))
        self.assertEqual(anchors, {"dup", "dup-1", "dup-2"})

    def test_headings_inside_code_fences_ignored(self):
        anchors = c.anchors_for(
            self._write("# Real\n\n```\n# Not A Heading\n```\n")
        )
        self.assertIn("real", anchors)
        self.assertNotIn("not-a-heading", anchors)


class TestLinkDetection(unittest.TestCase):
    def test_matches_inline_link_but_not_image(self):
        found = c.LINK.findall("see [docs](docs/x.md) and ![img](y.png)")
        self.assertEqual(found, ["docs/x.md"])


class TestImageAltText(unittest.TestCase):
    def test_image_with_alt_captured(self):
        self.assertEqual(c.IMAGE.findall("![a description](x.png)"), [("a description", "x.png")])

    def test_image_missing_alt_has_empty_group(self):
        alts = [alt for alt, _ in c.IMAGE.findall("![](x.png)")]
        self.assertEqual(alts, [""])


class TestCodeStripping(unittest.TestCase):
    def test_inline_code_example_ignored(self):
        # Documenting `![](x)` in prose must not be scanned as a real image.
        self.assertNotIn("![](x)", c.strip_code("see `![](x)` for the pattern"))

    def test_fenced_block_stripped(self):
        self.assertEqual(c.strip_code("```\n![](x)\n```\n").strip(), "")

    def test_normal_text_preserved(self):
        self.assertIn("![real](y.png)", c.strip_code("![real](y.png)"))


if __name__ == "__main__":
    unittest.main()
