# GraphQL crawler optimization

## Decisions

- Base the `graphql` branch on `main` after `chore(crawler): use official GitHub API types (#266)`.
- Use GraphQL as the main repository metadata path; keep REST for changed marketplace content and legacy rows without a GitHub node ID.
- Backfill missing node IDs through REST once. On temporary GraphQL batch failures, keep existing repository data and record a warning instead of fanning out to REST.
- Start batches at 25 repositories; grow to 50 after stable responses and reduce to 25 or 10 when latency, cost, or errors rise.
- Keep a 10% GraphQL quota reserve, honor GitHub reset and retry headers, and record cost, latency, remaining quota, and waits.
- Replace static Code Search size ranges with recursive splitting when `total_count >= 1000`.
- Run the full pilot against a fresh, empty local SQLite database in `crawler/temp`. Do not point the pilot at or copy the Railway production database.
- Export the draft to a temporary directory outside `ui`, then compare `README.md`, `ui/src/data/repos.json`, and `ui/src/data/stats.json` with the current checked-in files.

## Implementation

- [x] Add `github_node_id`, `marketplace_oid`, and REST ETag columns to SQLite with a migration.
- [x] Persist node IDs during discovery and use them for GraphQL batches.
- [x] Fetch repository metadata and the marketplace blob OID through GraphQL.
- [x] Skip marketplace content requests when the OID is unchanged and a plugin count is already stored.
- [x] Fetch and recount marketplace content only when the OID changes or the count is missing.
- [x] Add REST ETag/`If-None-Match` handling for fallback and content requests.
- [x] Add GraphQL quota guardrails, retries for secondary limits, and run/notification metrics.
- [x] Replace the static size-range list with adaptive Code Search splitting.
- [x] Build the branch from the latest `main` containing PR #266.
- [x] Run crawler build and unit suite: 312 tests pass.
- [x] Run TypeScript typecheck.
- [x] Fix formatting/import issues reported by Biome and rerun lint.
- [x] Preserve the previous marketplace count and OID if a changed OID unexpectedly returns 304.
- [x] Record GraphQL request latency in run metrics and notifications.

## Local pilot and comparison

- [x] Create a fresh local SQLite database per run and provide a read-only GitHub token only through the hidden local prompt.
- [x] Run a full crawl with publication disabled against the fresh database.
- [x] Record total duration, Code Search request count, GraphQL batch count/cost/latency, marketplace content request count, waits, and errors in the run log.
- [x] Export the prepared draft outside `ui`.
- [x] Compare the exported README and both JSON files with the current repository artifacts; report row-level differences and explain expected changes.

## Follow-up: prevent catalog loss and verify discovery coverage

Do these in order. The current local crawl is still running, so do not open, copy, migrate, or otherwise touch its SQLite database until it finishes.

1. [ ] After the current run completes, seed/restore a local database from a prior catalog snapshot and rerun the comparison against the checked-in catalog. Keep the production Railway database untouched. Compare removals and additions by repository URL so a run against an empty database is not mistaken for a production-equivalent crawl.
2. [x] When GraphQL returns a repository but no `.claude-plugin/marketplace.json` OID, confirm absence through REST Contents before deleting the catalog row. Keep the row on transient REST failures; delete only on confirmed 404. Add coverage for found, 404, and temporary-error results.
3. [x] Recover incomplete Code Search ranges: retry an unexpectedly short page once, and if pagination still returns fewer items than `total_count`, split a splittable size range and search both halves. Retain the warning on ranges that cannot be split and test that recovered ranges preserve all discovered URLs.
