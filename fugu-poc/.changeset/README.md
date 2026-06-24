# Changesets

This folder holds [changesets](https://github.com/changesets/changesets). Add one
for every user-facing change:

```bash
npm run changeset
```

The release workflow consumes accumulated changesets to version the package, write
`CHANGELOG.md`, and publish to npm.
