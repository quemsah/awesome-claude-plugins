# Performance Budget

The homepage must not hydrate the full repository catalog on first load.

## Current Baseline

- Full checked-in catalog: `ui/src/data/repos.json`
- Current catalog size: 7,629,986 bytes
- Server-rendered first page: 24 repositories

## Budget

`npm run payload:check` compares the serialized first-page search result with the full catalog.

The check fails when either limit is exceeded:

- First-page serialized result is greater than 250,000 bytes.
- First-page serialized result is greater than 8% of `repos.json`.

The budget is intentionally much higher than the expected first page so normal copy and metadata changes do not fail CI, while accidental full-catalog hydration does.

