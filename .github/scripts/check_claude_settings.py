#!/usr/bin/env python3
"""Structural validator for .claude/settings.json — stdlib only, no network.

The Actions allow-list rules out a marketplace JSON-schema action, so this is a
small stdlib check. Beyond "is it valid JSON" (json.tool already covers that), it
verifies the settings are well-formed *and* that every hook command path it
references actually exists and is executable — catching a renamed, moved, or
typo'd hook before it silently no-ops in a real session.

Checks:
  * top level is a JSON object;
  * hooks.<Event> is a list of matcher groups, each with a "hooks" list;
  * each command hook has type == "command", a non-empty "command" string, and an
    optional integer "timeout";
  * each command's ${CLAUDE_PROJECT_DIR}-relative script exists and is executable;
  * env (if present) maps keys to string values;
  * sandbox.filesystem.allowWrite (if present) is a list of strings.

Exit 1 if any problem is found.
"""
from __future__ import annotations

import json
import os
import re
import sys

SETTINGS = ".claude/settings.json"
VAR = re.compile(r"\$\{?CLAUDE_PROJECT_DIR\}?")


def expand(command: str, project_dir: str) -> str:
    """Resolve the ${CLAUDE_PROJECT_DIR} token to project_dir."""
    return VAR.sub(project_dir, command)


def _check_command_hook(hook: dict, where: str, project_dir: str) -> list[str]:
    errors: list[str] = []
    command = hook.get("command")
    if not isinstance(command, str) or not command.strip():
        return [f"{where}.command: must be a non-empty string"]
    timeout = hook.get("timeout")
    if timeout is not None and not isinstance(timeout, int):
        errors.append(f"{where}.timeout: must be an integer")
    script = expand(command, project_dir).split()[0]
    if not os.path.isfile(script):
        errors.append(f"{where}.command: script not found -> {script}")
    elif not os.access(script, os.X_OK):
        errors.append(f"{where}.command: script not executable -> {script}")
    return errors


def validate(settings: object, project_dir: str) -> list[str]:
    if not isinstance(settings, dict):
        return ["settings.json: top level must be a JSON object"]

    errors: list[str] = []
    hooks = settings.get("hooks", {})
    if not isinstance(hooks, dict):
        errors.append("hooks: must be an object")
        hooks = {}
    for event, groups in hooks.items():
        if not isinstance(groups, list):
            errors.append(f"hooks.{event}: must be a list")
            continue
        for i, group in enumerate(groups):
            inner = group.get("hooks") if isinstance(group, dict) else None
            if not isinstance(inner, list):
                errors.append(f"hooks.{event}[{i}].hooks: must be a list")
                continue
            for j, hook in enumerate(inner):
                where = f"hooks.{event}[{i}].hooks[{j}]"
                if not isinstance(hook, dict):
                    errors.append(f"{where}: must be an object")
                    continue
                if hook.get("type") != "command":
                    errors.append(f'{where}.type: expected "command", got {hook.get("type")!r}')
                    continue
                errors += _check_command_hook(hook, where, project_dir)

    env = settings.get("env", {})
    if not isinstance(env, dict):
        errors.append("env: must be an object")
    else:
        for k, v in env.items():
            if not isinstance(v, str):
                errors.append(f"env.{k}: must be a string")

    sandbox = settings.get("sandbox", {})
    if not isinstance(sandbox, dict):
        errors.append("sandbox: must be an object")
    else:
        fs = sandbox.get("filesystem", {})
        if not isinstance(fs, dict):
            errors.append("sandbox.filesystem: must be an object")
        else:
            allow = fs.get("allowWrite", [])
            if not isinstance(allow, list) or not all(isinstance(p, str) for p in allow):
                errors.append("sandbox.filesystem.allowWrite: must be a list of strings")

    return errors


def main() -> int:
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", ".")
    try:
        with open(SETTINGS, encoding="utf-8") as fh:
            settings = json.load(fh)
    except FileNotFoundError:
        print(f"::error::{SETTINGS} not found")
        return 1
    except json.JSONDecodeError as e:
        print(f"::error::{SETTINGS}: invalid JSON: {e}")
        return 1

    errors = validate(settings, project_dir)
    for e in errors:
        print(f"::error::{e}")
    print(f"checked {SETTINGS}: {len(errors)} problem(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
