# 2. Non-allow-listed CI tools run as pinned binaries, not marketplace actions

- Status: accepted
- Date: round 2 (reaffirmed round 4)

## Context

The org enforces a GitHub **Actions allow-list**: only `actions/*`, `github/*`, and a few named
marketplace actions may be `uses:`. A non-allow-listed action makes the job fail at startup
(`startup_failure`) — we hit this with a marketplace markdown link-checker.

## Decision

For any tool not on the allow-list (`actionlint`, `ruff`, the link checker, …), either implement
it in **stdlib Python** or download the **pinned, SHA256-checksum-verified release binary** in a
`run:` step. Never add it as `uses:`.

## Consequences

- ✅ CI stays green under the allow-list; the supply chain stays pinned and verifiable.
- ✅ The pattern is uniform — see the `actionlint` / `ruff` steps in `.github/workflows/lint.yml`.
- ➖ Binary version + SHA are semi-manual; a Renovate `customManager` surfaces version bumps and
  the checksum check fails closed until the SHA is refreshed (intended — forces human verification).
