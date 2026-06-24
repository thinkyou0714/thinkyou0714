#!/usr/bin/env python3
"""Unit tests for check_claude_settings.py.

Run locally or in CI (lint.yml):
    python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_claude_settings as c  # noqa: E402


class TestValidate(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.hook = os.path.join(self.dir, "hook.sh")
        with open(self.hook, "w", encoding="utf-8") as f:
            f.write("#!/usr/bin/env bash\nexit 0\n")
        os.chmod(self.hook, 0o755)
        self.addCleanup(self._cleanup)

    def _cleanup(self):
        for path in (self.hook,):
            if os.path.exists(path):
                os.remove(path)
        if os.path.isdir(self.dir):
            os.rmdir(self.dir)

    def _settings(self, command="${CLAUDE_PROJECT_DIR}/hook.sh"):
        return {
            "hooks": {
                "SessionStart": [
                    {
                        "matcher": "startup",
                        "hooks": [{"type": "command", "command": command, "timeout": 10}],
                    }
                ]
            },
            "env": {"AGMSG_TEAM": "x"},
            "sandbox": {"filesystem": {"allowWrite": ["~/.agents/skills/agmsg/"]}},
        }

    def test_valid_settings_pass(self):
        self.assertEqual(c.validate(self._settings(), self.dir), [])

    def test_missing_script_flagged(self):
        errs = c.validate(self._settings("${CLAUDE_PROJECT_DIR}/nope.sh"), self.dir)
        self.assertTrue(any("not found" in e for e in errs))

    def test_non_executable_script_flagged(self):
        os.chmod(self.hook, 0o644)
        errs = c.validate(self._settings(), self.dir)
        self.assertTrue(any("not executable" in e for e in errs))

    def test_bad_hook_type_flagged(self):
        s = self._settings()
        s["hooks"]["SessionStart"][0]["hooks"][0]["type"] = "nope"
        self.assertTrue(any(".type:" in e for e in c.validate(s, self.dir)))

    def test_non_string_env_flagged(self):
        s = self._settings()
        s["env"]["AGMSG_TEAM"] = 5
        self.assertTrue(any("env.AGMSG_TEAM" in e for e in c.validate(s, self.dir)))

    def test_allowwrite_must_be_list(self):
        s = self._settings()
        s["sandbox"]["filesystem"]["allowWrite"] = "nope"
        self.assertTrue(any("allowWrite" in e for e in c.validate(s, self.dir)))

    def test_top_level_must_be_object(self):
        self.assertTrue(c.validate(["x"], self.dir))

    def test_expand_token_both_forms(self):
        self.assertEqual(c.expand("${CLAUDE_PROJECT_DIR}/a.sh", "/p"), "/p/a.sh")
        self.assertEqual(c.expand("$CLAUDE_PROJECT_DIR/a.sh", "/p"), "/p/a.sh")


if __name__ == "__main__":
    unittest.main()
