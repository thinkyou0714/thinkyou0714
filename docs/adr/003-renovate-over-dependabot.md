# 3. Renovate is the single dependency updater

- Status: accepted
- Date: round 1 (reaffirmed round 4)

## Context

Both Dependabot and Renovate can update dependencies and pin GitHub Action digests. Running both
produces duplicate PRs and conflicting digest churn.

## Decision

Use **Renovate** only — `renovate.json` extends the org preset + `helpers:pinGitHubActionDigests`,
plus a `customManager` for the pinned CI binaries. **Dependabot is disabled**; `dependabot.yml`
was removed.

## Consequences

- ✅ One updater, one source of truth for pinned digests.
- ✅ Renovate's `customManager` also tracks the `run:`-binary versions (ADR 002).
- ➖ GitHub may still display a cosmetic "Dependabot Updates" entry in the Actions tab; it runs no
  duplicate jobs and can be ignored or turned off in settings.
