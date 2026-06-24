# agmsg adoption — 100-idea deep-dive backlog

A deduplicated catalog distilled from a structured deep-dive into agmsg's design, its
documented limitations, and current best practices for Claude Code hooks/skills and
multi-agent governance. Each item is tagged:

- **[done]** — shipped in this repo (config / hook / docs).
- **[rec]** — recommended action on *your machine* or workflow; can't be committed here.
- **[roadmap]** — deliberately deferred. Many are sound in the abstract but **over-engineered
  for a plain-text bash+sqlite tool on a solo profile repo**; recorded so the rationale is
  explicit, not lost.

> Guiding principle: introduce agmsg *well* without bolting on infrastructure agmsg doesn't
> have (message schemas, signing, brokers). Harden the **adoption**, not a fork of the tool.

---

## A. Install & bootstrap

1. **[done]** SessionStart hook that **never fails the session** (EXIT-trap forces exit 0, even on `set -u` abort).
2. **[done]** Hook is **idempotent** — safe to run on every startup.
3. **[done]** Hook is **source-aware**: silent on `resume`/`compact`, advises on `startup`/`clear`.
4. **[done]** Detect `sqlite3` (agmsg's only hard dep); on absence, advise + exit 0 instead of breaking.
5. **[done]** Detect `npx` and branch install advice (marketplace vs npx vs git clone).
6. **[done]** No-jq stdin parsing (sed) so the hook has zero extra deps.
7. **[done]** `${CLAUDE_PROJECT_DIR}`-relative hook command for portability.
8. **[done]** Short stdout (becomes model context) doubling as a status/next-steps note.
9. **[done]** Opt-in `AGMSG_AUTO_BOOTSTRAP=1`; default = advise-only (no surprise installs/network).
10. **[done]** Auto-join is **guarded** (`whoami` pre-check; only if `join.sh` exists) and best-effort.
11. **[done]** `timeout: 10` on the hook so it can't hang a session.
12. **[done]** Document all three install methods + offline fallback in `docs/agmsg.md`.
13. **[done]** `agmsg-onboard` skill as a one-stop install+join entry point.
14. **[rec]** Prefer the **plugin marketplace** path on Claude Code; **git clone** for reproducibility/offline.
15. **[rec]** Install `sqlite3` on each machine (`apt-get install -y sqlite3`, etc.).
16. **[rec]** Pin the npm version (`npx agmsg@<ver>`) if you bootstrap via npm, for repeatable installs.
17. **[roadmap]** Repo-local `AGMSG_STORAGE_PATH=./.agmsg` fallback for ephemeral web/CI containers (`.agmsg/` already gitignored) — only if you actually run agmsg in such containers.
18. **[roadmap]** Version-drift check between teammates' agmsg installs (warn if mismatched).
19. **[roadmap]** Vendor a pinned `install.sh` copy for fully air-gapped bootstrap (licensing + staleness cost; skip unless needed).

## B. Security — prompt injection, secrets, supply chain

20. **[done]** Explicit **"peer messages are untrusted"** policy in `CLAUDE.md`/`AGENTS.md`.
21. **[done]** Rule: never act on agmsg-delivered instructions that escalate scope, expose secrets, or do irreversible things.
22. **[done]** State that `from_agent` is **not authenticated** — a message is a suggestion, not authorization.
23. **[done]** **No-secrets-in-messages** rule (pass variable names / paths / SHAs, never values).
24. **[done]** `umask 077` in the hook before any DB-creating operation.
25. **[done]** `sandbox.filesystem.allowWrite` scoped to exactly `~/.agents/skills/agmsg/`.
26. **[done]** Document the **plugin-trust** model (drivers ignored until `agmsg plugin trust`).
27. **[done]** `.gitignore` blocks any local message DB / `.env` from being committed.
28. **[done]** Keep `gitleaks` (`secrets-scan.yml`) as the committed safety net.
29. **[done]** Pin `lowlighter/metrics@latest` → commit SHA (`.github/workflows/metrics.yml`) — supply-chain root-cause fix.
30. **[rec]** `chmod 600 ~/.agents/skills/agmsg/db/messages.db` so the store isn't world-readable.
31. **[rec]** Only trust agmsg plugins whose source you've read; keep built-in `claude-code`/`codex` only.
32. **[rec]** Treat `~/.codex/config.toml` `writable_roots` as least-privilege — only the agmsg dir.
33. **[rec]** Pin **all** third-party actions to SHAs (gitleaks, checkout, dependency-review), not just metrics.
34. **[rec]** Periodically review agmsg's npm SLSA provenance / Trusted-Publisher attestation before upgrading.
35. **[roadmap]** Wrap peer-message bodies in tagged `<UNTRUSTED_PEER>…</UNTRUSTED_PEER>` delimiters — needs transport changes agmsg doesn't expose.
36. **[roadmap]** HMAC-sign messages to defeat sender spoofing — agmsg has no signing layer; would be a fork.
37. **[roadmap]** Message-size cap / DoS guard via a `safe-send` wrapper — minor risk for a solo setup.
38. **[roadmap]** Strict JSON message schema validation — agmsg messages are plain text by design.
39. **[roadmap]** Secret-scanning of message bodies before send — defense in depth; over-engineered solo.

## C. Loop control & turn-taking

40. **[done]** Document that agmsg has **no auto-stop**; loops end only by convention.
41. **[done]** **Turn budget** convention (default ≤ 5 exchanges) stated in CLAUDE.md/AGENTS.md/skill.
42. **[done]** Explicit **`DONE:` / `BLOCKED:`** terminal signal required from implementers.
43. **[done]** "Peer silent past budget → time out and ask the human" rule (no infinite re-ping).
44. **[done]** `/goal` template embeds the turn budget + DONE requirement in every handoff.
45. **[rec]** For monitor mode, prime a fresh session with a short "hi" so it reacts to the first inbound.
46. **[rec]** Keep coordination to a few exchanges; escalate long back-and-forth to a GitHub issue/PR thread.
47. **[roadmap]** Circuit-breaker detecting A→B→A handoff cycles — useful at scale, manual is fine solo.
48. **[roadmap]** Per-agent token/cost budgets + hourly alerts — belongs to the runner, not this repo.
49. **[roadmap]** Cooldown enforcement between consecutive messages — agmsg already has a check cooldown.

## D. Delivery modes

50. **[done]** Mode comparison table (monitor/turn/both/off) with latencies in `docs/agmsg.md`.
51. **[done]** Recommend **`both`** for an active Claude↔Codex pair (real-time + safety net).
52. **[done]** Recommend **`turn`** when the Stop-hook "error:" label is distracting.
53. **[done]** Recommend **`monitor`** for solo Claude Code.
54. **[done]** Document the informational Stop-hook output that Claude Code can prefix with **"error:"** so it isn't mistaken for a fault.
55. **[rec]** Tune monitor poll interval to taste (responsiveness vs. resource use).
56. **[rec]** On Codex, default to `turn`; treat `monitor` as beta (needs `~/.agents/bin` early on PATH).
57. **[roadmap]** Supervisor/heartbeat to restart a vanished monitor task — prefer `both`/`turn` fallback instead.
58. **[roadmap]** Exponential-backoff wrapper around a silently-failing `watch` loop — upstream concern.

## E. Identity & operations

59. **[done]** Pin the repo's **team name** (`AGMSG_TEAM=thinkyou0714`) in committed settings.
60. **[done]** Stable default agent name (`claude-$USER`) via the hook.
61. **[done]** "Run agmsg from the **repo root**" guidance to avoid phantom registrations.
62. **[done]** `/agmsg reset` documented to clear a bad project registration.
63. **[done]** Document update (`install.sh --update`) and uninstall (`--keep-data`) paths.
64. **[rec]** Include hostname in agent names across machines (`claude-$USER-$(hostname -s)`) to avoid collisions.
65. **[rec]** Back up `messages.db` periodically if coordination history matters (it's local only).
66. **[rec]** Stage agmsg upgrades on one machine before rolling to all teammates.
67. **[rec]** Keep `AGMSG_STORAGE_PATH` consistent across an agent's machines for one shared store.
68. **[roadmap]** Immutable audit log of all messages (retention triggers) — compliance-grade, unneeded solo.
69. **[roadmap]** Roster pre-allocation / name suggestions to prevent duplicate identities.
70. **[roadmap]** Track agmsg identity redesign (project-path decoupling) and plan a `reset` migration on upgrade.
71. **[roadmap]** Windows `cygpath -m` path-fix note for native sqlite3 — only if you use native Windows (prefer WSL2).

## F. Governance, QA & handoff

72. **[done]** Three explicit **roles** (orchestrate / implement / QA) in CLAUDE.md.
73. **[done]** `/goal` handoff template (objective, target files, do-not-touch, done-criteria, verify, report, budget).
74. **[done]** **Fable QA checklist** (requirements, scope, regressions, security, governance fit, verdict).
75. **[done]** "Codex must finish implementation, not stop at investigation" baked into `/goal`.
76. **[done]** "Spec/scope decisions belong to the human/orchestrator, not the implementer" rule.
77. **[done]** **Ask-the-human policy**: only on material forks (ambiguous intent, irreversible, scope/cost jump, undefined acceptance).
78. **[done]** "Proceed on best practices otherwise; don't stall on defaults" rule.
79. **[rec]** Add agent-attribution git trailers (`Orchestrated/Implemented/Verified-by`) for auditability.
80. **[rec]** Link each agent task to its PR/issue for traceability.
81. **[rec]** Run the Fable QA pass before every push that agents produced.
82. **[roadmap]** Machine-readable per-agent capability/allowlist config — overkill for one human + a couple of agents.
83. **[roadmap]** Decision-record log of why each handoff/escalation happened.

## G. Repo fit, docs & DX

84. **[done]** Add the long-promised **`CLAUDE.md` + `AGENTS.md`** (README claimed them as "canonical"; they didn't exist).
85. **[done]** Keep them **DRY** — AGENTS.md points to CLAUDE.md as the single source.
86. **[done]** `$schema` reference in `.claude/settings.json` for editor validation.
87. **[done]** First-ever **`.gitignore`** for this repo (local state, secrets, OS cruft).
88. **[done]** `docs/agmsg.md` guide + this backlog as committed, reviewable artifacts.
89. **[done]** README: add agmsg to the stack + a pointer to the guide.
90. **[done]** Match house governance style (least-privilege, idempotent, pinned, minimal diffs).
91. **[done]** Non-colliding skill name (`agmsg-onboard`) so it never shadows the real `/agmsg`.
92. **[rec]** Add `agmsg` to the profile's topic tags / pinned-repo narrative if showcasing it.
93. **[rec]** Cross-link `ccmux` / `github-flow-kit` docs to the same multi-agent protocol for consistency.
94. **[roadmap]** A tiny CI lint that fails on unpinned `uses:` actions (enforce idea #33 repo-wide).

## H. Verification & honesty

95. **[done]** `bash -n` + `shellcheck`-clean hook, with the never-fail guarantee proven by test.
96. **[done]** JSON/YAML of new + edited config validated to parse.
97. **[done]** Pinned metrics SHA verified to resolve to the real v3.34 commit before committing.
98. **[done]** Stated plainly that this container can't run agmsg end-to-end (no sqlite3, no Codex CLI, ephemeral).
99. **[done]** Substituted a **Fable-model subagent** for the "Fable 5 max" QA role; documented Codex as a local-run step (no `codex rescue` here).
100. **[rec]** Once on your machine: install agmsg, `/agmsg` join `thinkyou0714`, pair Claude↔Codex with `mode both`, and run a real two-agent task end-to-end to confirm.

---

### What was intentionally NOT built (and why)

agmsg is **plain-text messages over a local SQLite file** — by design. The research surfaced a
tempting pile of "enterprise" additions: signed messages, JSON schemas, message brokers, audit
databases, cost dashboards, supervisor daemons. Building those here would (a) fork the tool,
(b) contradict its no-daemon/no-framework ethos, and (c) add maintenance burden a solo profile
repo shouldn't carry. They're parked in **[roadmap]** so the door stays open without paying for
it now.

---

## Round 2 — governance, supply chain & self-validation

Round 1 hardened the agmsg *adoption*; round 2 hardens the *repo around it* (supply-chain
pinning, least privilege, self-validating CI) and polishes docs. Cumulative catalog:
**132 ideas** (100 + 32). Same tags ([done]/[rec]/[roadmap]).

### N. Supply-chain action pinning

101. **[done]** Pin `actions/checkout` to a SHA (`# v4.2.2`) in secrets-scan + dependency-review (was floating `@v4`).
102. **[done]** Pin `gitleaks/gitleaks-action` to a SHA (`# v2.3.9`) — stay on the current major; Renovate proposes v3 separately.
103. **[done]** Pin `actions/dependency-review-action` to a SHA (`# v4.9.0`).
104. **[done]** Add `helpers:pinGitHubActionDigests` to `renovate.json` so Renovate keeps every action SHA-pinned and bumps the `# vX.Y` comment automatically — pinning becomes *maintained*, not a one-off.
105. **[done]** Verify each pinned SHA resolves to the intended release before commit (github.com commit page; `api.github.com`/`git` are proxy-blocked here).
106. **[done]** `persist-credentials: false` on read-only checkouts (secrets-scan, dependency-review, lint) — no token left on disk for steps that never push.
107. **[rec]** Review + merge Renovate's eventual major-bump PRs (checkout v5, gitleaks v3, dependency-review v5) deliberately, not blind.
108. **[roadmap]** CI pin-enforcement via `zizmor` (fail on unpinned `uses:`) — Renovate + review already maintain pins; overlap not worth it at this size.
109. **[roadmap]** `step-security/harden-runner` egress policy — enterprise-grade; overkill for a profile repo.
110. **[roadmap]** SHA-pin first-party `actions/*` too once Renovate is confirmed managing digests (low risk; first-party).

### O. Least privilege & workflow hygiene

111. **[done]** Remove `pull-requests: write` from `metrics.yml` — dead since the job switched to `output_action: commit` (direct SVG commit, no PR).
112. **[done]** Add `timeout-minutes: 10` to `dependency-review.yml` (was unbounded).
113. **[done]** Keep top-level `permissions:` minimal across workflows; grant write only at the job that needs it.
114. **[rec]** Consider top-level `permissions: {}` + per-job grants once verified not to disturb the finicky metrics action.
115. **[roadmap]** Branch protection requiring `lint` / `secrets-scan` / `dependency-review` on `main` (repo Settings — not committable from here).

### P. Self-validating CI (new `lint` workflow)

116. **[done]** `shellcheck` the SessionStart hook on every PR/push so it can't silently regress.
117. **[done]** Validate `.claude/settings.json` parses as JSON in CI.
118. **[done]** Validate every workflow YAML parses in CI.
119. **[done]** Markdown link + **anchor** check via a dependency-free stdlib script (`.github/scripts/check_md_links.py`) — verifies relative links exist and `#anchors` resolve to GitHub heading slugs (would have caught the round-1 `#4-goal-handoff-template` fix). A marketplace link-checker was the first attempt but the repo's Actions allow-list blocks it — see #131.
120. **[done]** `lint` is least-privilege (`contents: read`), SHA-pinned, with `concurrency:` + `timeout-minutes:`.
121. **[roadmap]** `actionlint` for deeper workflow-security lint — shellcheck + YAML + Renovate cover the high-value cases for now.
122. **[roadmap]** `markdownlint` style rules — noisy; link/anchor correctness matters more than style here.

### Q. Repo hygiene & governance files

123. **[done]** First `.editorconfig` (LF, final newline, trim trailing WS; markdown exempt so hard line-breaks survive).
124. **[done]** `.shellcheckrc` so local and CI shellcheck agree.
125. **[done]** `.github/SECURITY.md` using GitHub **private vulnerability reporting** (no email address committed).
126. **[done]** Agent-attribution git-trailer convention (`Implemented-by` / `Verified-by` / `Orchestrated-by`) in `CLAUDE.md`.
127. **[rec]** Optional `.pre-commit-config.yaml` (shellcheck + gitleaks + whitespace) for local pre-commit — CI already covers it, so left to preference.
128. **[roadmap]** Issue/PR templates, `docs/CI.md`, `security.txt`, `FUNDING.yml` — noise for a solo profile repo; revisit if it gains contributors.
129. **[roadmap]** OpenSSF Scorecard workflow — useful signal, low ROI at this size; add if the repo grows.

### R. Doc correctness

130. **[done]** Re-verify internal markdown anchors/links resolve — now enforced by the `lint` link-check henceforth. (The `agmsg-onboard` skill's `/goal` link was corrected to `#4-goal-handoff-template` per GitHub's heading-anchor rules.)

### S. Working with the repo's Actions allow-list (discovered in CI)

131. **[done]** The repo enforces a **GitHub Actions allow-list** (only `actions/*`, verified-marketplace, and patterns like `gitleaks/gitleaks-action@*`, `lowlighter/metrics@*`). A first attempt to use a marketplace link-checker (`lycheeverse/lychee-action`) caused a `startup_failure`; the pinned `actions/checkout`, `actions/dependency-review-action`, and `gitleaks-action` all comply.
132. **[done]** Replaced the marketplace link-checker with the stdlib `.github/scripts/check_md_links.py` so the link/anchor gate runs under the allow-list with no third-party action.

---

## Round 3 — testing, static analysis, docs governance & the profile

Rounds 1–2 added the agmsg adoption and hardened the repo's supply chain. Round 3 **tests the
new code** the repo now ships (Python + the hook), adds **workflow/code static analysis**
(`actionlint`, CodeQL), consolidates the **CI/allow-list docs**, and makes a first, deliberately
**conservative pass on the profile product** (accessibility + native Sponsor button — no
personal-voice rewrite). Three research streams (profile/community, security/CI, agmsg/docs)
surfaced ~107 raw candidates, consolidated below. Cumulative catalog: **180 ideas**
(100 + 32 + 48). Tags add `[assessed]` (looked at, already-safe/no change), `[verified]`
(checked externally), and `[hold]` (owner's call, offered not imposed).

### T. Testing the new code (Python + hook)

133. **[done]** Unit tests for `check_md_links.py` (`.github/scripts/test_check_md_links.py`): slug algorithm incl. the real `#4-goal-handoff-template` case, dedup suffixes, code-fence exclusion, image/external skip. Run in `lint`.
134. **[done]** Hook never-fail smoke test in `lint` — asserts exit 0 for all four SessionStart sources (`startup`/`resume`/`clear`/`compact`).
135. **[done]** Fixed an unclosed-file `ResourceWarning` in `check_md_links.py` (context managers) — surfaced immediately by the new tests.
136. **[rec]** `bats` hook tests with mocked `sqlite3`/`join.sh` for the auto-join path — deeper than the smoke test; add if the hook grows.
137. **[roadmap]** `ruff` + `mypy --strict` on `.github/scripts/` — nice polish, deferred (one clean stdlib module; the unit tests give more signal per unit of CI).

### U. Workflow & code static analysis

138. **[done]** `actionlint` via a **pinned, checksum-verified** release binary in `lint` (allow-list-safe as a `run:` binary; it also shellchecks every `run:` block).
139. **[done]** **CodeQL** (Python) workflow — `github/codeql-action` SHA-pinned (GitHub-authored ⇒ allow-list-OK), least-privilege, PR + push + weekly.
140. **[rec]** `zizmor` (Actions security lint) as a pinned binary — overlaps actionlint's high-value checks; add if workflows get complex.
141. **[roadmap]** OpenSSF Scorecard — re-evaluated; still low ROI at this size (round 2 #129 stands) and not allow-listed as an action.
142. **[roadmap]** SLSA provenance for workflow definitions — not a shipping GitHub feature yet.
143. **[rec]** Extend `lint`'s JSON/YAML validation to *all* configs under `.claude/`+`.github/` (today just `settings.json`) — trivial generalization when more configs appear.
144. **[roadmap]** Renovate `customManager` regex to auto-bump the `actionlint` version+SHA in `lint.yml` (today hand-maintained; a stale SHA fails the checksum, i.e. fails closed).

### V. Workflow robustness & least privilege

145. **[done]** `metrics.yml` `cancel-in-progress: false` — don't cancel a commit-producing run mid-flight; overlapping triggers queue instead.
146. **[done]** CodeQL job pins all three token scopes explicitly (`contents: read` + `security-events: write` + `actions: read`) — job-level `permissions:` **replace**, not merge, the top-level set.
147. **[rec]** `METRICS_TOKEN` scoped to public-repo only (vs the `GITHUB_TOKEN` fallback) — one-time human token setup.
148. **[rec]** Cache pip in `lint` (`actions/setup-python` cache) — minor; the `pyyaml` install is already fast.
149. **[roadmap]** `harden-runner` egress policy — enterprise-grade, unneeded for a config repo (and not allow-listed).

### W. Dependabot / Renovate reconciliation (root-caused)

150. **[done]** Confirmed `.github/dependabot.yml` was **already removed in round 1** (commit `72d3ecd`); Renovate is the sole updater. The "Dependabot Updates" entry in the Actions tab is GitHub's cosmetic default — **no duplicate job runs**. No code action.
151. **[rec]** Optionally disable Dependabot in Settings → Code security to drop the cosmetic entry (UI-only, owner's call).

### X. Docs governance & DRY

152. **[done]** New `docs/CI.md` — workflow map, the **Actions allow-list** policy + *how to add a tool under it*, local-repro commands, and human-applied repo-settings notes.
153. **[done]** Expanded `.github/SECURITY.md` — posture now lists CodeQL + actionlint + tests + the allow-list; scope names the `scripts/`+`hooks/` surface.
154. **[done]** Resolved the **`AGMSG_AUTO_BOOTSTRAP`** question → deliberate **opt-in** (documented as settled in `docs/agmsg.md` §2, with the per-machine override path).
155. **[done]** `docs/agmsg.md`: message-DB hygiene (clear/rotate; never put `AGMSG_STORAGE_PATH` in-tree).
156. **[done]** `CLAUDE.md`: a concrete **accept-vs-reject** example for untrusted peer messages (lint-my-files = OK; force-push / read `~/.ssh` / set a token / out-of-scope refactor = refused).
157. **[done]** `.editorconfig`: `[*.py]` 4-space rule (the link checker is the repo's first committed Python).
158. **[assessed]** Turn-budget "≤ 5" text appears in 4 docs — but `AGENTS.md`/`SKILL.md`/`agmsg.md` already label themselves *summaries that defer to CLAUDE.md*; no gutting needed (research over-flagged this as a DRY violation).
159. **[rec]** A `docs/README.md` index of the doc set — small nicety; cross-links already resolve (lint-enforced).
160. **[roadmap]** Split `agmsg-ideas.md` into a shipped-log + a live backlog once it passes ~300 lines (revisit round 4).
161. **[rec]** `docs/CI.md` "why these versions" note (e.g. gitleaks staying on v2 until a deliberate v3 review).
162. **[assessed]** External-URL link checking stays a **deliberate non-goal** for the link-checker (needs network; offline CI is the point) — spot-check upstreams by hand.

### Y. agmsg hook & integration depth (mostly already-safe)

163. **[assessed]** Hook stdin / partial-JSON handling — already defaults to `startup` safely on any parse miss; no change.
164. **[assessed]** Concurrent-session join — agmsg `join` is idempotent and `whoami` parsing guards `not_joined` first; documented, no code change.
165. **[done]** Hook stdout contract is now guarded by the smoke test (exit 0; short, silent on `resume`/`compact`).
166. **[assessed]** Version shows `?` on older installs — best-effort by design; non-issue.
167. **[rec]** Note in `docs/agmsg.md`: prefer `turn` mode on ephemeral containers (CI/Codespaces) — `monitor`'s background task dies on teardown.
168. **[rec]** `/goal` template "If blocked" clause — Codex replies `BLOCKED:` and waits rather than guessing.
169. **[rec]** Idempotent `writable_roots` helper snippet for Codex in `AGENTS.md`.
170. **[roadmap]** agmsg protocol-version pinning across machines — upstream is pre-1.0; revisit on a breaking release.
171. **[roadmap]** Multi-team templating (`AGMSG_TEAM` is hardcoded) — fine for a solo repo; document as a fork-time assumption.

### Z. The profile product (deliberately conservative)

172. **[done]** Richer **alt text** on the metrics SVG (screen-reader accessibility) — markup, not voice.
173. **[done]** `.github/FUNDING.yml` (`github: thinkyou0714`) — renders the native **Sponsor** button.
174. **[verified]** All five linked repos + `fujibee/agmsg` resolve (HTTP 200) and the Sponsors page exists — **no dead links**; the `申請中`/`準備中`/`順次公開予定` markers are honest status, left in the owner's voice.
175. **[hold]** Condensing those status markers, CI/license badges, About/FAQ/Acknowledgments, bilingual restructure — personal-profile **voice**; offered to the owner, not imposed.
176. **[hold]** Repo topics, description, social-preview image, pinned-repos curation, profile bio — GitHub-UI/owner decisions; recommended in chat, not committed.
177. **[roadmap]** `CONTRIBUTING` / `CODE_OF_CONDUCT` / `MAINTAINERS` / issue templates — noise for a solo profile repo (round 2 #128 stands) until it gains contributors.
178. **[assessed]** `dependency-review` already auto-covers a future `requirements.txt` — no action unless Python deps are added.
179. **[rec]** Quarterly "is everything still pinned/least-privilege?" glance — a habit, not a workflow.
180. **[done]** This round's verification was an independent QA pass (Fable 5 unavailable in-env) + green CI — recorded honestly rather than asserting a Fable verdict.
