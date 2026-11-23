# Bounded refresh for already-ready repositories

Daily crawling previously re-fetched **every** previously enriched repository on each run, making enrichment duration grow with the catalog (roughly 67k ready repositories as of November 2026).

The crawler now separates two workloads:

- **Pending candidates** (`plugins_count IS NULL`): the existing rotating `ENRICHMENT_MAX_PENDING_CANDIDATES` budget (default **3,000**) is unchanged.
- **Previously ready repositories** (`plugins_count IS NOT NULL`): a second, independent rotating cohort limited by `READY_REFRESH_MAX_CANDIDATES` (default **10,000**) per daily run. Already-ready repositories outside the cohort retain their cached catalog data; no GitHub metadata/marketplace requests are made for those rows.

Both cohorts use SQLite settings cursors, based on repository IDs, and wrap around after the last eligible ID. The ready-refresh cursor advances **only after each contiguous completed portion** (including handled API errors and completed retries). If a run is interrupted, unprocessed ready rows are selected again rather than skipped for a whole rotation. A persistently failing but handled request does not starve later IDs. Newly successful pending candidates join the ready rotation on future runs.

**Safety exceptions:** incomplete or invalid canonical identities and cached manifests with missing/stale parser versions or invalid plugin-summary JSON or unusable standalone summaries (which must contain exactly one plugin) are processed immediately even if outside the ready cohort. The existing independent **200-repository daily health check** for deleted/renamed links continues unchanged. The normal GraphQL batching, cached OIDs/ETags, retry rules, GitHub rate-budget handling and publication behavior remain in place.

## Capacity planning

With ~67,000 ready repositories and the default 10,000 ready-refresh cap, a full rotation takes approximately **7 successful daily runs**. As the catalog grows the cadence becomes longer unless `READY_REFRESH_MAX_CANDIDATES` is adjusted.

For each successful crawl inspect `enrichment.readyRefreshSelected` and `enrichment.readyRefreshSkipped` alongside `pendingQueueBefore` / `pendingQueueAfter`, API request totals and elapsed time. `updated` will decrease sharply by design: skipping an unchanged cached row is not data loss.

To change the trade-off, set the env variable on the _existing_ Railway crawler service (for example `READY_REFRESH_MAX_CANDIDATES=12000`); no extra service or database is required. If a complete ready refresh is urgently necessary, temporarily set the cap above the current ready catalog size and watch API budgets and run duration; restore the bounded value afterwards.

The setting is independent of the Repository Search budget (120) and pending-enrichment budget (3,000), and does not change the schedule or automatically run the draft backfill PR #449.
