# 1. agmsg auto-join is opt-in, not default-on

- Status: accepted
- Date: round 1 (reaffirmed round 4)

## Context

The SessionStart hook (`.claude/hooks/agmsg-bootstrap.sh`) could auto-join the agmsg team on
every fresh session. Auto-join is convenient, but it runs on *every* startup — including
ephemeral web/CI containers — and mutates shared state (the team roster) without the human
asking.

## Decision

Default to **advise-only**. The hook detects and reports agmsg state but only best-effort joins
when `AGMSG_AUTO_BOOTSTRAP=1` is explicitly set (per-machine, in git-ignored
`.claude/settings.local.json`). It never installs software or touches the network on its own.

## Consequences

- ✅ Consent over convenience; no surprise roster entries from throwaway sessions.
- ✅ The hook keeps its never-fail / no-side-effect-by-default contract.
- ➖ A human opts in once per machine to get hands-free joining.
