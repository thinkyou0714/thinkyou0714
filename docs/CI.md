# CI & workflows

What runs in CI, why, and how to work within this repo's constraints. Companion to
[`../CLAUDE.md`](../CLAUDE.md) (the canonical agent protocol).

## Workflows

| Workflow | Triggers | Does | Token scope |
|---|---|---|---|
| [`lint`](../.github/workflows/lint.yml) | PR, push to `main` | shellcheck the hook + never-fail smoke test, validate `settings.json` + workflow YAML, **actionlint**, link-checker **unit tests**, markdown link/anchor check | `contents: read` |
| [`secrets-scan`](../.github/workflows/secrets-scan.yml) | PR, push to `main` | gitleaks secret scan | `contents: read` |
| [`dependency-review`](../.github/workflows/dependency-review.yml) | PR | flags vulnerable/newly-added deps | `contents: read` |
| [`codeql`](../.github/workflows/codeql.yml) | PR, push to `main`, weekly | CodeQL static analysis of the Python | `contents: read` + `security-events: write` |
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
3. **Anything else** (e.g. `actionlint`, `zizmor`) → **do not** add it as `uses:`. Download the
   pinned, checksum-verified release binary in a `run:` step instead — see the `actionlint`
   step in [`lint.yml`](../.github/workflows/lint.yml) for the pattern.

Pin third-party `uses:` to a commit SHA with a `# vX.Y` comment; Renovate keeps digests
current (`helpers:pinGitHubActionDigests`). Binaries pinned by version+SHA256 are maintained
by hand (bump both together; a stale SHA fails the checksum, which is the safe outcome).

## Reproduce CI locally

Before pushing, the `lint` gate is fully reproducible:

```bash
shellcheck .claude/hooks/*.sh
python3 -m json.tool .claude/settings.json >/dev/null
python3 -m unittest discover -s .github/scripts -p 'test_*.py'
python3 .github/scripts/check_md_links.py
# actionlint: download the pinned release binary (see lint.yml) then: ./actionlint
```

## Repository settings (human-applied, not committable)

A few governance controls live in GitHub settings rather than in files. Recommended:

- **Branch protection** on `main`: require PR + the `lint` / `secrets-scan` /
  `dependency-review` / `codeql` checks, require up-to-date branches.
- **Dependabot**: disabled in favour of Renovate (single updater). GitHub may still show a
  cosmetic "Dependabot Updates" entry in the Actions tab; no duplicate job runs.
- **Secret-scanning push protection**: on.
