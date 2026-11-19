# Manual enrichment-only backfill

The daily crawl combines GitHub discovery, health checks, existing-repository refresh, and pending-candidate enrichment. A manual backfill is useful when discovery adds candidates faster than the daily enrichment cap can process them.

## Run

From `awesomeclaudeplugins.com/crawler`, with the same `DB_PATH` and `GITHUB_READ_TOKEN` used by the crawler:

```sh
bun run build
bun run backfill:enrichment --limit 1000
```

- `--limit` is **required**, must be an integer from **1 to 3000**, and is an upper bound on _pending candidates selected_, not on individual HTTP requests.
- The backfill is **opt-in and manually invoked**. It is not added to the Railway cron or automatic deploy/start command.
- It uses the same persisted SQLite **pending-candidate cursor**, the existing GraphQL/REST batching and retry policy, and the existing GitHub API rate-budget logic.
- It **does not run Code Search, Repository Search, health checks, or full-catalog refresh**. Already-enriched repositories are not queried again.
- It **writes to the database**, even though it doesn't publish. It produces no catalog draft, Git commit, or Telegram success notification. The next normal daily crawl publishes the changes.
- Only one crawler/backfill run can be active at a time. An active run causes a skip without making GitHub requests; a held publication lease prevents backfill. A backfill never recovers another run or steals its lease.
- On shutdown/failure the run is marked failed, and already committed row changes remain. The next run continues fairly via the existing rotating cursor. Use the normal stopped-run recovery procedure **only after** verifying that the process has stopped.

## Production safeguards

**Do not create an independent Railway service/volume for backfill.** An empty or copied DB would not drain the real queue. Run only where the crawler's actual existing mounted DB is accessible, after verifying the mount and when the scheduled crawl is not running. Avoid starting a backfill close enough to the scheduled crawl that it could overlap; a concurrent daily crawl is deliberately skipped rather than racing.

Start with `--limit 1000`. Check the structured `crawl.backfill_completed` event and final summary:

- `pendingQueueBefore` / `pendingQueueAfter` — exact eligible queue before/after
- `pendingQueueSelected` and `newReady` — processed selections vs new ready repositories
- `oldestPendingCreatedAt` — how far back the remaining queue reaches
- `rateBuckets.core` / `rateBuckets.graphql` — request counts, waits, retries, remaining

If rate limits or execution time become excessive, use a smaller `--limit` on the _next_ manual invocation. No environment or production cron change is necessary.

## Notes

The regular `ENRICHMENT_MAX_PENDING_CANDIDATES` setting still controls the daily crawl and is unaffected by manual `--limit`. Running the backfill does not itself publish newly indexed repositories; catalog totals only change after the next normal publication.
