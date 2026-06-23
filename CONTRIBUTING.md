# Contributing

This repository publishes a checked-in catalog and a generated README. Contributions are most useful when they keep those two surfaces consistent.

## Catalog corrections

Open an issue or pull request when a repository is missing, duplicated, stale, incorrectly described, or counted with the wrong plugin total. Include the GitHub URL and the specific field that should change.

## README updates

Do not edit the repository table by hand. Update the checked-in catalog data first, then regenerate the README:

```sh
cd ui
npm run readme:generate
npm run readme:check
```

The CI check fails when `README.md` drifts from `ui/src/data/repos.json` or `ui/src/data/stats.json`.

