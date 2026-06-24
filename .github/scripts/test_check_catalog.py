#!/usr/bin/env python3
"""Unit tests for check_catalog.py.

Run locally or in CI (lint.yml):
    python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_catalog as c  # noqa: E402


class TestCheck(unittest.TestCase):
    def test_contiguous_tagged_items_pass(self):
        text = "1. **[done]** a\n2. **[rec]** b\n3. **[roadmap]** c\n"
        self.assertEqual(c.check(text), [])

    def test_gap_flagged(self):
        errs = c.check("1. **[done]** a\n3. **[done]** c\n")
        self.assertTrue(any("not contiguous" in e for e in errs))

    def test_duplicate_flagged(self):
        errs = c.check("1. **[done]** a\n1. **[done]** a2\n")
        self.assertTrue(any("not contiguous" in e for e in errs))

    def test_unknown_tag_flagged(self):
        self.assertTrue(any("unknown tag" in e for e in c.check("1. **[bogus]** a\n")))

    def test_items_in_code_fences_ignored(self):
        # The fenced "2." must be skipped, so the real list stays contiguous.
        text = "1. **[done]** a\n```\n2. **[done]** fenced\n```\n2. **[rec]** real\n"
        self.assertEqual(c.check(text), [])

    def test_empty_catalog_flagged(self):
        self.assertTrue(c.check("no numbered items here\n"))


if __name__ == "__main__":
    unittest.main()
