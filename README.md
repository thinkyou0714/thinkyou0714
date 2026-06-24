# thinkyou0714

![Auto-refreshed GitHub metrics for thinkyou0714 — most-used languages, commit activity, starred topics, and the contribution calendar](github-metrics.svg)

> **Solo AI-automation dev** — building Claude Code × n8n × Obsidian tooling for JP/EN devs.
> 🇯🇵 AI 自動化を軸に、開発ワークフローと知識ベースを自作している個人開発者です。

[![lint](https://github.com/thinkyou0714/thinkyou0714/actions/workflows/lint.yml/badge.svg)](https://github.com/thinkyou0714/thinkyou0714/actions/workflows/lint.yml)
[![codeql](https://github.com/thinkyou0714/thinkyou0714/actions/workflows/codeql.yml/badge.svg)](https://github.com/thinkyou0714/thinkyou0714/actions/workflows/codeql.yml)
[![secrets-scan](https://github.com/thinkyou0714/thinkyou0714/actions/workflows/secrets-scan.yml/badge.svg)](https://github.com/thinkyou0714/thinkyou0714/actions/workflows/secrets-scan.yml)
[![dependency-review](https://github.com/thinkyou0714/thinkyou0714/actions/workflows/dependency-review.yml/badge.svg)](https://github.com/thinkyou0714/thinkyou0714/actions/workflows/dependency-review.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-db61a2.svg)](https://github.com/sponsors/thinkyou0714)

I run [**THINK YOU LAB**](https://github.com/thinkyou0714/lab-public) — a one-person research lab for AI-assisted developer workflows, knowledge-base automation, and "personal AIOS" infrastructure.

## Currently working on

- 🔗 **agmsg adoption** — wiring [`fujibee/agmsg`](https://github.com/fujibee/agmsg) in as the Claude Code × Codex coordination layer ([how this repo uses it](docs/agmsg.md))
- 🧰 [`ccmux`](https://github.com/thinkyou0714/ccmux) — Claude Code multiplexer (Zellij × git worktree × Obsidian)
- 📝 [`github-flow-kit`](https://github.com/thinkyou0714/github-flow-kit) — 4 Claude Code skills for GitHub-native devs (pr-respond, release-notes, issue-triage, repo-tour)
- 🌐 [`public-docs`](https://github.com/thinkyou0714/public-docs) — Next.js + MDX implementation-guide template
- ✍️ [`zenn-content`](https://github.com/thinkyou0714/zenn-content) — Zenn 記事ソース (AI 自動化・LAB infra)

## Stack

| Layer | Tools |
|---|---|
| AI Coding | Claude Code · Codex · Cursor (CLAUDE.md + AGENTS.md canonical) · [agmsg](https://github.com/fujibee/agmsg) cross-agent messaging |
| Automation | n8n (200+ WF) · autoclaw (Claude proxy) · Slack bot infra |
| Knowledge | Obsidian Local REST API + Supabase pgvector + Ollama embeddings |
| Web | Next.js 16 · Supabase · Stripe · Vercel · Docker |

## Topics I write about

`claude-code` `agentic-workflow` `mcp` `model-context-protocol` `n8n` `obsidian` `ai-automation` `solo-dev` `developer-tooling` `personal-aios`

## How this repo is run

This profile doubles as a **governance showcase** — least-privilege, pinned, and self-validating:

- 🔒 GitHub Actions pinned to commit SHAs (Renovate-maintained); `gitleaks`, `dependency-review`, and **CodeQL** (`security-extended`) gate every PR.
- ✅ A self-validating `lint` workflow: shellcheck + `actionlint` + `ruff`, stdlib unit tests, and checks for settings, doc links/anchors/alt-text, and catalog numbering — see [`docs/CI.md`](docs/CI.md) · [decisions](docs/adr/README.md) · [changelog](CHANGELOG.md).
- 🤝 Multi-agent coordination (Claude Code × Codex × Fable QA) runs over agmsg — protocol in [`docs/agmsg.md`](docs/agmsg.md) · [all docs](docs/README.md).

> 🤖 **AI agents working in this repo:** start with [`CLAUDE.md`](CLAUDE.md) (the canonical protocol), then [`AGENTS.md`](AGENTS.md).

## Reach & support

- 📨 Issues & PRs welcome on any of the repos above
- 🌐 [github.com/thinkyou0714](https://github.com/thinkyou0714) · ✍️ Zenn 記事を順次公開中
- ❤️ [GitHub Sponsors](https://github.com/sponsors/thinkyou0714) — open-source の仕事が役立ったら応援歓迎です

---

_Auto-refreshed daily via [lowlighter/metrics](https://github.com/lowlighter/metrics). Solo lab work, JP/EN parallel — pinned repos curated per portfolio narrative._
