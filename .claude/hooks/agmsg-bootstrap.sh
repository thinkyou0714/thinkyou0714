#!/usr/bin/env bash
#
# agmsg-bootstrap.sh — SessionStart hook for the agmsg multi-agent messaging layer.
#
# Contract (see .claude/settings.json and docs/agmsg.md):
#   * NEVER block or fail a session. Always exit 0, even on every error path.
#   * Idempotent: safe to run on every startup; cheap on resume/compact.
#   * No network or install side effects by default. It only *detects and advises*.
#     Opt in to best-effort auto-join with AGMSG_AUTO_BOOTSTRAP=1.
#   * stdout is short and is injected into the model's context (SessionStart behaviour),
#     so it doubles as a one-screen status + next-steps note for the agent.
#
# Tunables (all optional; sensible defaults):
#   AGMSG_TEAM            team name for this repo        (default: repo directory name)
#   AGMSG_AGENT           this session's agent name      (default: claude-$USER)
#   AGMSG_AUTO_BOOTSTRAP  "1" => best-effort auto-join   (default: advise only)
#   AGMSG_SKILL_DIR       agmsg install dir              (default: ~/.agents/skills/agmsg)
#
# Dependencies: bash + sqlite3 (agmsg's only hard deps). Missing deps => advise + exit 0.

set -u
# Deliberately NOT `set -e`: this hook must never abort a session.

# --- Always exit cleanly, whatever happens. -------------------------------------------
# An EXIT trap that calls `exit 0` forces a 0 status on every path — including a `set -u`
# abort on an unset variable — so the hook can never block or fail a session.
trap 'exit 0' EXIT

PREFIX="[agmsg]"
say() { printf '%s %s\n' "$PREFIX" "$*"; }

# --- Parse the SessionStart JSON from stdin (no jq dependency). ------------------------
# We only need "source" (startup|resume|clear|compact). Keep it tolerant of formatting.
HOOK_INPUT=""
if [ ! -t 0 ]; then
  HOOK_INPUT="$(cat 2>/dev/null || true)"
fi
SOURCE="$(printf '%s' "$HOOK_INPUT" \
  | sed -n 's/.*"source"[[:space:]]*:[[:space:]]*"\([a-zA-Z]*\)".*/\1/p' \
  | head -n1)"
SOURCE="${SOURCE:-startup}"

# Resume/compact: the agent already has context. Stay quiet and cheap.
case "$SOURCE" in
  resume|compact) exit 0 ;;
esac

# --- Resolve identity + paths. --------------------------------------------------------
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
REPO_NAME="$(basename "$PROJECT_DIR" 2>/dev/null || echo project)"
TEAM="${AGMSG_TEAM:-$REPO_NAME}"
AGENT="${AGMSG_AGENT:-claude-${USER:-dev}}"
SKILL_DIR="${AGMSG_SKILL_DIR:-${HOME:-/root}/.agents/skills/agmsg}"

# --- Detect dependencies + install state. ---------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

HAS_SQLITE=0; have sqlite3 && HAS_SQLITE=1
HAS_NPX=0;    have npx     && HAS_NPX=1
INSTALLED=0;  [ -d "$SKILL_DIR/scripts" ] && INSTALLED=1

# --- Branch: not installed. -----------------------------------------------------------
if [ "$INSTALLED" -eq 0 ]; then
  if [ "$HAS_SQLITE" -eq 0 ]; then
    say "not installed; sqlite3 is missing (agmsg's only hard dep)."
    say "install sqlite3, then:  /plugin marketplace add fujibee/agmsg  ->  /plugin install agmsg@fujibee-agmsg"
    say "(or:  npx agmsg )   See docs/agmsg.md. Team for this repo: '$TEAM'."
    exit 0
  fi
  if [ "$HAS_NPX" -eq 1 ]; then
    say "not installed. Bootstrap with:  npx agmsg   (or the /plugin marketplace path)."
  else
    say "not installed and npx is unavailable. Use:  git clone https://github.com/fujibee/agmsg && ./agmsg/install.sh"
  fi
  say "After install, run /agmsg and join team '$TEAM' as '$AGENT'. See docs/agmsg.md."
  exit 0
fi

# --- Branch: installed. ---------------------------------------------------------------
# Keep any DB the join might create non-world-readable.
umask 077

VERSION="?"
if [ -x "$SKILL_DIR/scripts/version.sh" ]; then
  VERSION="$("$SKILL_DIR/scripts/version.sh" 2>/dev/null | head -n1 || echo '?')"
fi

if [ "$HAS_SQLITE" -eq 0 ]; then
  say "installed (v$VERSION) but sqlite3 is missing — messaging will not work until you install sqlite3."
  exit 0
fi

# Opt-in, best-effort, *guarded* auto-join. Never required; never fatal.
if [ "${AGMSG_AUTO_BOOTSTRAP:-0}" = "1" ] && [ -x "$SKILL_DIR/scripts/join.sh" ]; then
  already=0
  if [ -x "$SKILL_DIR/scripts/whoami.sh" ]; then
    "$SKILL_DIR/scripts/whoami.sh" "$PROJECT_DIR" claude-code 2>/dev/null \
      | grep -q "$TEAM" && already=1
  fi
  if [ "$already" -eq 0 ]; then
    if "$SKILL_DIR/scripts/join.sh" "$TEAM" "$AGENT" claude-code >/dev/null 2>&1; then
      say "auto-joined team '$TEAM' as '$AGENT' (v$VERSION). Check inbox with /agmsg."
    else
      say "ready (v$VERSION). Auto-join skipped (run /agmsg to join team '$TEAM' as '$AGENT')."
    fi
  else
    say "ready (v$VERSION). Already a member of team '$TEAM'. Check inbox with /agmsg."
  fi
else
  say "ready (v$VERSION). Run /agmsg to join team '$TEAM' as '$AGENT' (set AGMSG_AUTO_BOOTSTRAP=1 to auto-join)."
fi

exit 0
