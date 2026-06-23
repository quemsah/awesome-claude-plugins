# Catalog Generation

The README is generated from checked-in catalog data so reviewers can reproduce the public top-100 table without external services.

## Inputs

- `ui/src/data/repos.json`: repository records displayed by the app and README.
- `ui/src/data/stats.json`: historical catalog snapshot records, including the latest indexed repository count and UTC snapshot time.

## README generator

Run the generator from `ui/`:

```sh
npm run readme:generate
```

The generator sorts repositories by `stargazers_count` descending, then by `subscribers_count` descending. It writes the first 100 rows to the root `README.md`, includes the latest stats timestamp in UTC, and counts plugins from the checked-in repository records.

## Drift check

Run the check from `ui/`:

```sh
npm run readme:check
```

This command exits with a non-zero status when the generated README differs from the committed file. CI runs the same check to catch catalog and README drift.

