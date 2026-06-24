# Security Policy

## Reporting a vulnerability

Please report security issues **privately** via GitHub's
[private vulnerability reporting](https://github.com/thinkyou0714/thinkyou0714/security/advisories/new)
(the repo's **Security → Advisories → "Report a vulnerability"**). Do **not** open a public
issue for security problems.

Reports are acknowledged as soon as reasonably possible, with a fix and coordinated
disclosure to follow.

## Scope

This is a personal **profile + governance** repository: GitHub Actions workflows, agent
configuration (`.claude/`, `CLAUDE.md`, `AGENTS.md`), and documentation. It ships **no runtime
service and no secrets**. The most relevant surface is the CI workflows and the local `agmsg`
adoption — see [`docs/agmsg.md`](../docs/agmsg.md) for that tool's security model (peer
messages are untrusted; no secrets in messages; least-privilege sandbox).

## Posture

- Third-party GitHub Actions are pinned to commit SHAs (`# vX.Y`) and kept current via Renovate.
- `secrets-scan` (gitleaks) and `dependency-review` gate every PR; `lint` validates config/docs.
- Workflows declare least-privilege `permissions:`.
