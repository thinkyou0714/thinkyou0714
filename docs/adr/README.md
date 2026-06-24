# Architecture Decision Records (ADRs)

Short records of the load-bearing decisions in this repo, in a lightweight
[MADR](https://adr.github.io/madr/)-style format: context → decision → consequences.

| ADR | Decision |
|---|---|
| [001](001-opt-in-agmsg-bootstrap.md) | agmsg auto-join is **opt-in** (`AGMSG_AUTO_BOOTSTRAP`), not on by default. |
| [002](002-actions-allow-list.md) | Run non-allow-listed CI tools as **pinned `run:` binaries**, not marketplace actions. |
| [003](003-renovate-over-dependabot.md) | **Renovate** is the single dependency updater; Dependabot is disabled. |

New ADRs are append-only and numbered; supersede rather than delete.
