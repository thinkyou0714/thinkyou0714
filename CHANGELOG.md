# Changelog

Notable changes to this profile + governance repo. Format follows
[Keep a Changelog](https://keepachangelog.com/). This repo isn't versioned/released, so entries
are grouped by the iterative hardening **rounds** catalogued in
[`docs/agmsg-ideas.md`](docs/agmsg-ideas.md).

## Round 4 — best-practice depth & self-validating governance

- **Added:** ruff (pinned binary) + CodeQL `security-extended`; stdlib validators for
  `.claude/settings.json` structure/hook-paths and the ideas-catalog numbering; image alt-text
  checking in the link-checker; opt-in `AGMSG_DEBUG` hook logging.
- **Added:** a docs index, three ADRs, and this changelog; a threat-model table, message
  conventions, a CI failure runbook, and a human-settings checklist.
- **Added:** light community-health files (PR template, issue `config.yml`, `SUPPORT.md`);
  `plugin_achievements` in metrics; more README badges.
- **Changed:** pinned `pyyaml` (Renovate-tracked); a Renovate `customManager` now surfaces the
  `actionlint` / `ruff` binary bumps; `workflow_dispatch` added to the re-runnable gates.

## Round 3 — test the code, static-analyze, consolidate docs

- **Added:** unit tests for the link-checker + a hook never-fail smoke test; `actionlint`
  (pinned binary); CodeQL; `docs/CI.md`; `SECURITY.md` / `FUNDING.yml`; a README presentation pass.

## Round 2 — supply-chain & governance hardening

- **Changed:** every GitHub Action SHA-pinned (Renovate-maintained); least-privilege
  `permissions:`; `persist-credentials: false`; timeouts + concurrency.
- **Added:** a self-validating `lint` workflow and a dependency-free link/anchor checker
  (replacing a marketplace action that hit the org allow-list); `.editorconfig`; `.shellcheckrc`.

## Round 1 — agmsg adoption

- **Added:** `CLAUDE.md` + `AGENTS.md` (multi-agent protocol); a never-fail SessionStart hook
  and the `agmsg-onboard` skill; `docs/agmsg.md`; and the idea catalog.
