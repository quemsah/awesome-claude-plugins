# Catalog search performance

The UI uses an immutable, in-memory SQLite FTS5 index, built when the catalog module
initializes. Searches perform matching, BM25 ranking, metric sorting, counting and
pagination in SQLite. Only the requested page crosses into JavaScript. There is no
query-result cache, so novel queries take the same path as repeated ones. Equal
metric keys are assigned a shared rank at initialization; BM25 is calculated only
for groups through the requested page's boundary, including every tied candidate.

Search uses Unicode words, AND between words and a prefix on the final word. All
repository and plugin search fields remain indexed, including legacy summaries and
plugins beyond the first 30. URLs are excluded. Quotes and FTS operators are treated
as literal input. The published 32-character cap remains unchanged.

This is full-text search rather than Fuse's approximate substring search: arbitrary
interior substrings and spelling corrections are no longer provided. The Unicode
tokenizer intentionally avoids Porter stemming, which would make some incomplete
last words unsearchable after the 32-character truncation (for example `capabilit`
versus the Porter stem `capabl` of `capability`).

## Reproduce

Run from `ui` with the project's Node 24 and Bun versions:

```sh
bun install --frozen-lockfile
bun run build
PORT=3001 bun run start
# In another terminal; create .local first if saving the report:
node scripts/benchmark-catalog-search.mjs --url http://127.0.0.1:3001 --out .local/search-proof.json
```

The script measures twelve uncached queries across all five sort modes, a burst of ten
distinct concurrent HTTP queries, then 50 requests/second for 60 seconds. The workload
mixes distinct real repository names with broad prefixes. It checks all responses,
throughput and p95 in three equal time windows. Separate simulated clients prevent
the public per-client rate limit from replacing search work with HTTP 429 responses.
Index initialization and process startup are outside these steady-state measurements.

## Observed locally, 2026-11-01

On the checked-in 54,226-record catalog, the original 32-character no-match query
took 4,211 ms; the regression test measured 4,027 ms against its 50 ms limit.
FTS5's 60 query/sort combinations, including one-character final prefixes, measured
a maximum of 21.85 ms.

The production Next.js server completed 3,000/3,000 HTTP requests at 50.01 requests/s;
all 3,000 requests had matches. HTTP p50 was 11.50 ms, p95 24.95 ms and maximum 48.32 ms.
Window p95 values were 25.83, 24.85, 24.02 ms, with no accumulating delay.
The ten-query concurrent burst completed in 75.57 ms. These are local measurements,
not a guarantee for other hardware or catalog sizes.

## RAM A/B vs main

The RAM benchmark compares the exact PR head with its current base commit on one
GitHub Actions runner. It installs both revisions independently and executes three
separate Node 24 processes for each revision (alternating main/PR). The
`Catalog search memory A/B` workflow publishes median RSS and RSS deltas in the
Actions job summary, and uploads per-process JSON with heap, external and peak RSS.

Snapshots are taken after explicit GC: before loading `catalog.ts`, immediately
after import (FTS5 initialized in the PR, but not Fuse in main), after the first
query, and after six *different* searches. The benchmark checks that both revisions
use the identical checked-in `repos.json` file. Run locally by checking out
both revisions, installing dependencies in each root, then from each `ui`
directory invoking the PR's shared script with Node 24:

```sh
node --expose-gc /path/to/pr/ui/scripts/benchmark-catalog-memory.mjs --label main --out /tmp/main-memory.json
node --expose-gc /path/to/pr/ui/scripts/benchmark-catalog-memory.mjs --label pr --out /tmp/pr-memory.json
node /path/to/pr/ui/scripts/benchmark-catalog-memory.mjs --baseline /tmp/main-memory.json --candidate /tmp/pr-memory.json
```

This isolates the incremental footprint of the catalog module and different
search cache strategies. It **does not measure the full Next.js production process**:
separate server bundles can initialize more than one module/index instance. RSS
also does not directly determine Railway charges; use production memory metrics
and Railway's actual billing model for a cost estimate.
