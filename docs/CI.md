# CI & workflows

What runs in CI, why, and how to work within this repo's constraints. Companion to
[`../CLAUDE.md`](../CLAUDE.md) (the canonical agent protocol).

## Workflows

| Workflow | Triggers | Does | Token scope |
|---|---|---|---|
| [`lint`](../.github/workflows/lint.yml) | PR, push, dispatch | shellcheck + never-fail smoke test (incl. `AGMSG_DEBUG`), validate `settings.json` (JSON + structure + hook paths) & workflow YAML, **actionlint**, **ruff**, **unit tests**, markdown link/anchor/alt-text check, catalog-numbering check | `contents: read` |
| [`secrets-scan`](../.github/workflows/secrets-scan.yml) | PR, push, dispatch | gitleaks secret scan | `contents: read` |
| [`dependency-review`](../.github/workflows/dependency-review.yml) | PR | flags vulnerable/newly-added deps | `contents: read` |
| [`codeql`](../.github/workflows/codeql.yml) | PR, push, weekly, dispatch | CodeQL static analysis of the Python (**`security-extended`** suite) | `contents: read` + `security-events: write` |
| [`metrics`](../.github/workflows/metrics.yml) | daily cron, `workflow_dispatch`, push to `main` | regenerate & commit `github-metrics.svg` | job: `contents: write` |

All declare explicit `permissions:`, `concurrency:`, and `timeout-minutes:`. Read-only
checkouts set `persist-credentials: false`.

## The Actions allow-list (important)

This repo is under an org **Actions allow-list**: only GitHub-authored actions (`actions/*`,
`github/*`), verified-marketplace actions, and explicitly-listed patterns
(`gitleaks/gitleaks-action@*`, `lowlighter/metrics@*`, `release-drafter/release-drafter@*`,
`x-color/zenn-post-scheduler@*`) may run. **Anything else fails the run at startup**
(`startup_failure`) — this is how the policy surfaces (see `docs/agmsg-ideas.md` #131).

To add a new tool:

1. **GitHub-authored** (`actions/`, `github/`) → use it directly, SHA-pinned (e.g. CodeQL).
2. **Allow-listed marketplace action** → use it, SHA-pinned.
3. **Anything else** (e.g. `actionlint`, `ruff`, `zizmor`) → **do not** add it as `uses:`.
   Download the pinned, checksum-verified release binary in a `run:` step instead — see the
   `actionlint` and `ruff` steps in [`lint.yml`](../.github/workflows/lint.yml) for the pattern.

Pin third-party `uses:` to a commit SHA with a `# vX.Y` comment; Renovate keeps digests current
(`helpers:pinGitHubActionDigests`). The pinned **binaries** (`actionlint`, `ruff`) are
version+SHA256 in `lint.yml`: a Renovate `customManager` (see [`renovate.json`](../renovate.json))
surfaces version bumps, and you refresh the matching `*_SHA256` from the release checksums — the
lint job's `sha256sum -c` fails closed until you do, which is the safe outcome.

## Reproduce CI locally

Before pushing, the `lint` gate is fully reproducible:

```bash
shellcheck .claude/hooks/*.sh
python3 -m json.tool .claude/settings.json >/dev/null
python3 .github/scripts/check_claude_settings.py
python3 -m unittest discover -s .github/scripts -p 'test_*.py'
python3 .github/scripts/check_md_links.py
python3 .github/scripts/check_catalog.py
# actionlint + ruff: download the pinned release binaries (see lint.yml), then:
#   ./actionlint    and    ruff check --config .github/scripts/ruff.toml .github/scripts/
```

## When a check fails

| Failing check | Likely cause → fix |
|---|---|
| `lint` › ShellCheck | A shell issue in `.claude/hooks/*.sh`. Run `shellcheck .claude/hooks/*.sh`; fix the cited `SCxxxx`. |
| `lint` › Hook smoke test | The hook returned non-zero or leaked debug to stdout. It must always `exit 0`; keep `AGMSG_DEBUG` output on stderr. |
| `lint` › settings structure | A renamed/removed hook or malformed `.claude/settings.json`. Run `check_claude_settings.py`; the message names the bad path/key. |
| `lint` › Validate workflow YAML | A YAML syntax error; the message names the file. Fix and re-parse locally. |
| `lint` › actionlint | An invalid workflow or unsafe `run:` block. Run the pinned `actionlint`; a stale `ACTIONLINT_SHA256` fails the checksum (refresh it). |
| `lint` › ruff | A Python finding in `.github/scripts/`. Run `ruff check --config .github/scripts/ruff.toml .github/scripts/` (most are `--fix`-able). |
| `lint` › Unit tests | A regression in a checker. Run `python3 -m unittest discover -s .github/scripts -p 'test_*.py'`. |
| `lint` › markdown links | A broken relative link/anchor or an image missing alt text. `check_md_links.py` names the file + target. |
| `lint` › catalog numbering | `docs/agmsg-ideas.md` numbers skipped/duplicated or an unknown `[tag]`. Run `check_catalog.py`. |
| `secrets-scan` (gitleaks) | A detected secret. Rotate it if real; never commit values. |
| `dependency-review` | A newly-added dependency is vulnerable (`fail-on-severity: high`). Bump or replace it. |
| `codeql` | A flagged pattern in the Python — see the Security tab annotation. |
| A new job shows `startup_failure` | A `uses:` action that isn't on the allow-list — switch to a pinned `run:` binary (above). |

## Repository settings (human-applied, not committable)

A few governance controls live in GitHub settings rather than in files. Recommended:

- **Branch protection / ruleset** on `main`: require a PR + the `lint` / `secrets-scan` /
  `dependency-review` / `codeql` checks, require up-to-date branches. (A repository **ruleset**
  is the modern, exportable form; keep a JSON copy in-repo for the record if you adopt one.)
- **Dependabot**: disabled in favour of Renovate (single updater). GitHub may still show a
  cosmetic "Dependabot Updates" entry in the Actions tab; no duplicate job runs.
- **Secret-scanning push protection**: on — blocks pushes containing a detected secret
  (prevention ahead of the `gitleaks` detection gate).
- **About** panel: a concise description, a homepage URL, and **topics** (e.g. `claude-code`,
  `agentic-workflow`, `github-actions`, `ai-automation`, `governance`) — the main discoverability lever.
- **Social preview** image for nicer link unfurls; enable **Discussions** if you want a Q&A
  space separate from issues.
- **OpenSSF Best Practices** badge: self-certify at <https://www.bestpractices.dev/> once the
  posture is stable — it externalises the security story this repo already lives.
