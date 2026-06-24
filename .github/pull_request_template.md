<!-- Keep PRs small and on-topic. Open as draft; let CI gate the merge. -->

## What & why

<!-- One or two lines. Link the related issue or catalog idea if there is one. -->

## Checklist

- [ ] CI is green (`lint`, `secrets-scan`, `dependency-review`, `codeql`)
- [ ] No secrets in the diff (variable *names* only, never values)
- [ ] Docs updated if behaviour/workflows changed (`docs/CI.md`, `docs/agmsg.md`, the catalog)
- [ ] New `uses:` actions are SHA-pinned + allow-listed; new CLI tools run as pinned binaries
- [ ] Multi-agent work credits contributors via git trailers (`Implemented-by:` / `Verified-by:`)
