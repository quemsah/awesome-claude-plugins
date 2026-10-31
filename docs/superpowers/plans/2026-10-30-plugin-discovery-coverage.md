# Claude Plugin Discovery Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Find more public GitHub repositories that host valid Claude Code marketplace plugins, while making each discovery run's limits and coverage visible.

**Architecture:** Keep the existing Code Search crawler and its size-range checkpoints. Add GitHub Repository Search as a separate, bounded candidate source with a versioned query catalog and its own temporal-partition state. Feed candidates through the existing repository writer and marketplace parser so only repositories with a valid `.claude-plugin/marketplace.json` and at least one recognized plugin become publishable.

**Tech Stack:** TypeScript, GitHub REST API, SQLite (`better-sqlite3`), Vitest.

**Spec:** `docs/research/2026-10-30-github-plugin-discovery.md`

## Global Constraints

- Scope is public Claude Code plugin marketplaces accepted by the existing marketplace parser; standalone MCP server catalogs are out of scope.
- Do not add repositories from an allow-list or manually seed known misses. Query results are candidates; the existing manifest parser decides eligibility.
- Do not use star thresholds to claim completeness; they exclude new and low-star repositories.
- Repository Search indexes repository name, description, topics, and README text, not arbitrary repository files. Keep Code Search as a complementary source.
- A Repository Search query has a 1,000-result ceiling and may return partial results. Never label GitHub-wide coverage as complete.
- Bound each crawl to at most 20 Repository Search page requests initially; honor GitHub response headers, `Retry-After`, and secondary rate limits.

## Review Focus

- A saturated or incomplete GitHub result is never cached as a complete partition; saturated date windows split until each child is enumerable or explicitly remains incomplete.
- A crawl stopped by its request budget preserves the next page for that partition; the next attempt resumes there and upserts candidates idempotently. Incomplete responses or inconsistent pagination reset the cursor to page 1.
- The same repository returned by Code Search and Repository Search is counted once as a candidate and once in the catalog.
- Repositories without a valid marketplace manifest, including standalone MCP servers, never become publishable plugin entries.
- Query-catalog version changes invalidate only that source's old coverage; they do not corrupt or reset Code Search's `discovery_ranges`.

## File Map

- `awesomeclaudeplugins.com/crawler/src/github/client.ts` — typed Repository Search request and response parsing.
- `awesomeclaudeplugins.com/crawler/src/github/rateBudget.ts` — pacing and metrics for Repository Search requests.
- `awesomeclaudeplugins.com/crawler/src/github/repositorySearchQueries.ts` — versioned generic query families and temporal-window builders.
- `awesomeclaudeplugins.com/crawler/src/crawl/discoverRepositories.ts` — paginated candidate scan, saturation splitting, deduplication, and source summary.
- `awesomeclaudeplugins.com/crawler/src/storage/repositorySearch.ts` — durable partition checkpoints and coverage reads.
- `awesomeclaudeplugins.com/crawler/src/storage/discoveryCandidates.ts` — per-run source/query attribution for repositories discovered by either search source.
- `awesomeclaudeplugins.com/crawler/src/storage/schema.ts` — additive SQLite migration for Repository Search state.
- `awesomeclaudeplugins.com/crawler/src/crawl/runCrawl.ts` and `awesomeclaudeplugins.com/crawler/src/service/execute.ts` — run-level integration and reporting.
- `awesomeclaudeplugins.com/crawler/src/storage/inspect.ts` and `awesomeclaudeplugins.com/crawler/src/cli.ts` — operator-visible source health.
- Matching `*.test.ts` files — API parsing/rate behavior, query partitions, resumability, reporting, and schema migration.

---

### Task 1: Add a separately paced Repository Search API

**Files:**
- Modify: `awesomeclaudeplugins.com/crawler/src/github/client.ts`
- Modify: `awesomeclaudeplugins.com/crawler/src/github/rateBudget.ts`
- Test: `awesomeclaudeplugins.com/crawler/src/github/client.test.ts`
- Test: `awesomeclaudeplugins.com/crawler/src/github/rateBudget.test.ts`
- Modify: `awesomeclaudeplugins.com/crawler/src/service/execute.ts` (rate-bucket validation/serialization)

**Interfaces:**
- Produce `RepositorySearchPage = { total_count: number; incomplete_results: boolean; items: Array<Pick<GitHubRepo, 'html_url' | 'description' | 'node_id' | 'private'>> }`.
- Add `GitHubReader.searchRepositories(query: string, page: number): Promise<RepositorySearchPage>`; allow pages 1 through 10 and request 100 items per page.
- Add an internal `repo_search` rate bucket with 2,000 ms baseline pacing. Use response rate headers and retry metadata as the authority; do not assume the local bucket name is GitHub's `x-ratelimit-resource` value.

- [x] Add client tests that verify response parsing, `incomplete_results`, page bounds, and use of the `repo_search` bucket.
- [x] Add rate-budget tests that verify Repository Search pacing is independent from Code Search pacing and honors a server-provided reset/retry delay.
- [x] Implement the endpoint using `GET /search/repositories?q=...&per_page=100&page=...`; treat API errors using the existing GitHub error/retry conventions.
- [x] Extend serialized rate-bucket validation so stored crawl reports accept and validate `repo_search` counters.
- [x] Verify with `npm run typecheck` and the focused client/rate-budget tests.

### Task 2: Build bounded, resumable query partitions

**Files:**
- Create: `awesomeclaudeplugins.com/crawler/src/github/repositorySearchQueries.ts`
- Create: `awesomeclaudeplugins.com/crawler/src/crawl/discoverRepositories.ts`
- Create: `awesomeclaudeplugins.com/crawler/src/storage/repositorySearch.ts`
- Create: `awesomeclaudeplugins.com/crawler/src/storage/discoveryCandidates.ts`
- Modify: `awesomeclaudeplugins.com/crawler/src/crawl/discover.ts` (record Code Search provenance)
- Modify: `awesomeclaudeplugins.com/crawler/src/storage/schema.ts` (Repository Search schema version 17 after #404)
- Test: `awesomeclaudeplugins.com/crawler/src/github/repositorySearchQueries.test.ts`
- Test: `awesomeclaudeplugins.com/crawler/src/crawl/discoverRepositories.test.ts`
- Test: `awesomeclaudeplugins.com/crawler/src/storage/discoveryCandidates.test.ts`
- Test: `awesomeclaudeplugins.com/crawler/src/storage/schema.test.ts`

**Interfaces:**
- Define a versioned generic query catalog with stable `queryId`, `queryText`, and lane (`metadata`, `readme`, or `topic`); the initial implementation used version 1. Task 4's public-metadata audit advanced it to version 2, prioritizing reusable topic queries (`topic:claude-plugin`, `topic:claude-code-marketplace`, `topic:claude-code-plugins`, and `topic:claude-code-plugin`) before metadata and README queries. Do not include repository-owner/name exceptions.
- Define `discoverRepositories(db, reader, runId, onProgress, now, log): Promise<RepositoryDiscoverySummary>` and call the existing `createDiscoveryWriter` for candidate upserts.
- Store one checkpoint row per `(query_version, query_id, partition_key)` with status, last attempt/completion timestamps, total count, pages fetched, candidate count, `incomplete_results`, and saturation state. Keep this separate from `discovery_ranges`, whose ranges represent Code Search file-size intervals.
- Add `recordDiscoveryCandidate(db, runId, repositoryId, source, queryId)` to persist unique provenance rows keyed by run, repository, source, and query. Call it from both Code Search and Repository Search so cross-source overlap and post-enrichment plugin yield can be measured.

- [x] Add query-catalog tests for exact generated queries, version identity, and non-overlapping `created:`/`pushed:` windows.
- [x] Add scanner tests for pagination, duplicates across query families, private/invalid URLs, the 20-request cap, `total_count >= 1000`, `incomplete_results`, page-level continuation, and reset-to-page-1 behavior when a result set is inconsistent.
- [x] Add provenance tests proving the same repository is counted once per source, while a repository seen by both sources retains both source attributions.
- [x] Add migration tests proving existing size-range checkpoints survive schema version 14 unchanged.
- [x] Implement two scheduling lanes: give rolling `pushed:` work first priority with up to 15 of the 20 actual requests, then reserve up to five requests for the oldest-due historical `created:` sweep from 2008 through the current date. If no historical work is due or its queue drains early, use the remaining budget for rolling work. Use no star floor. Split crowded `pushed:` or `created:` windows into smaller date windows until each can be enumerated under GitHub's 1,000-result ceiling; dedupe overlapping results by canonical repository URL.
- [x] Cache only fully enumerated partitions. If a partition hits the per-run request budget or a transient request failure, keep it incomplete and resume from its persisted next page. Reset to page 1 on incomplete results, a changed result count, or a short page before the expected end. Make writes idempotent.
- [x] Add a 90-day refresh cadence for completed historical partitions, processing the oldest-due partitions first after the first sweep, so metadata/topic changes that do not appear in the rolling push lane are eventually revisited.
- [x] Write candidates to the existing repository table; let normal enrichment fetch and parse `.claude-plugin/marketplace.json`. The existing `plugins_count`/publishability rules remain the final gate, so standalone MCP repositories are not collected as plugins.
- [x] Cap new/unprocessed marketplace candidate enrichment at 200 per run; use a persistent cursor to prevent repeatedly failing low-ID candidates from starving later rows, leave over-cap candidates pending, and report the deferred count.
- [x] Verify with `npm run typecheck` and the focused query, scanner, and migration tests.

### Task 3: Integrate source summaries and distinguish completion from coverage

**Files:**
- Modify: `awesomeclaudeplugins.com/crawler/src/crawl/runCrawl.ts`
- Modify: `awesomeclaudeplugins.com/crawler/src/service/execute.ts`
- Modify: `awesomeclaudeplugins.com/crawler/src/storage/inspect.ts`
- Modify: `awesomeclaudeplugins.com/crawler/src/cli.ts`
- Test: `awesomeclaudeplugins.com/crawler/src/crawl/runCrawl.test.ts`
- Test: `awesomeclaudeplugins.com/crawler/src/service/execute.test.ts`
- Test: `awesomeclaudeplugins.com/crawler/src/storage/inspect.test.ts`

**Interfaces:**
- Extend the crawl discovery summary with per-source states: `code_search` and `repo_search`, each reporting `complete`, `incomplete`, or `not_due`, plus pages, queries/partitions, total results, unique candidates, new candidates, valid plugin marketplaces, rejected/non-plugin candidates, saturation, and warnings.
- Aggregate post-enrichment accepted marketplace counts by joining the per-run provenance rows to repository `plugins_count`; report source-attributed yield and total unique catalog additions separately so overlap is visible.
- Add structured events for Repository Search start, partition outcome, and phase completion. Every event includes query ID/version and partition key, but never a full response body or token.
- Extend `inspect` output with each source's last complete scan, due/stale state, incomplete partition count, and the fact that catalog coverage is bounded to the configured query catalog.

- [x] Add run-summary tests showing successful Code Search cannot mask incomplete Repository Search coverage.
- [x] Add CLI inspection tests for fresh, stale, incomplete, and never-run Repository Search states.
- [x] Emit counts at each funnel step: API hits, distinct repo candidates, new DB candidates, and marketplaces accepted by enrichment. Report raw result counts separately from eligible plugin counts.
- [x] Mark a source healthy only when its due partitions completed; a crawl can finish while source coverage is incomplete, but the summary must say so and preserve the reason.
- [x] Keep the two discovery channels operationally independent: if Code Search has no successful ranges, allow a run to continue when Repository Search completed a partition or produced candidates.
- [x] Surface an alert after two consecutive scheduled crawls fail to complete a due rolling partition or when a partition remains incomplete; do not interpret “zero warnings” as proof of global coverage.
- [x] Verify with `npm run typecheck` and the focused run-summary, CLI-inspection, and logging tests.

### Task 4: Validate recall and tune the catalog without hand-added repositories

**Files:**
- Modify: `docs/research/2026-10-30-github-plugin-discovery.md`
- Modify: `docs/superpowers/plans/2026-10-30-plugin-discovery-coverage.md` only if the query design changes after evidence

- [x] Run a read-only query audit for the known missed plugin examples `mnemoverse/claude-plugin` and `human-stuff/prodready`. The check measures whether generic query families return them; it must not write either repository into the crawler database or hard-code them into production queries. **Result:** Prodready was returned by generic topic queries; Mnemoverse remained absent from the bounded capture.
- [x] Run the initial scan against a copy of the crawler database with the 20-page cap; record API requests, candidate funnel, valid marketplace yield, incomplete partitions, added runtime, and whether both examples arrive through generic queries. **Result:** See the bounded audit table above; Mnemoverse partitions stayed incomplete at the request cap.
- [x] If a generic query family misses an example, inspect the public repository metadata/README and adjust a reusable query family or date partition. Do not add owner/repository-specific exceptions. **Result:** Added evidence-backed generic topic terms, made topic searches higher priority, and sorted rolling pushes by update recency; no manual repository exceptions.
- [x] Confirm that a repo-search-only standalone MCP server is rejected by the existing manifest gate, while a valid Claude marketplace with plugin entries is accepted.
- [ ] Start the production backfill only after the dry-run metrics fit the crawl's time and API budget. Keep the rolling lane on each crawl and drain historical partitions under the same fixed request cap.
- [x] Verify an operator can distinguish “configured sweep complete” from “GitHub-wide completeness”; do not claim the latter.

**Task 4 audit result (2026-10-30):** the bounded scanner returned `human-stuff/prodready` from generic topic queries, but did not return `mnemoverse/claude-plugin`. Its generic `topic:claude-plugin` pushed root (1,632 results) and Oct 16–30 child (1,177 results) were saturated; only the first page of each was attempted before the 20-request cap. A review found that the next day's shifted rolling root would not collect those old leaves. The fix now loads saved pending/incomplete pushed leaves from prior rolling roots, alternates them with newly generated rolling work so they cannot be perpetually starved by the request cap, and exposes them in `inspect`; focused multi-day and sustained-saturation regression tests pass. Do not mark the acceptance criterion requiring both targets as met. Production backfill was not started per the user's no-long-backfill constraint.

### Follow-up: durable page-level continuation

- [x] Add a `next_page` checkpoint and schema v18 migration, preserving existing partition coverage.
- [x] Resume incomplete partitions from the next page after a successful response; persist the current page before making its request so transient failures retry safely.
- [x] Reset to page 1 when GitHub reports incomplete results, the result count changes, or a short page appears before the advertised end.
- [x] Schedule unfinished leaves by least-recent attempt and include `nextPage` in repository-search coverage inspection.
- [x] Cover page-two discovery, later-page retry, cursor resets on changed counts/short pages, fair ordering, inspection, and migration with focused tests. Commits: `c9dc624`, `6ea65e1`.
- [x] Run a focused live cursor check in an isolated in-memory database: the generic October 30 `topic:claude-plugin` leaf resumed at page 2 and the crawler stored Mnemoverse from the live response.
- [ ] Run the full 20-request capped crawler audit against a database copy to measure end-to-end throughput and confirm the scheduler reaches that leaf from its normal initial state. No production backfill was run.

## Acceptance Criteria

- Repository Search discovers additional candidates independently from Code Search and never requires manual repository entries.
- `mnemoverse/claude-plugin` and `human-stuff/prodready` have both been observed from generic search results; a full capped audit must still confirm normal scheduler reachability and freshness. CorpusIQ is not used as a target or query seed.
- Only repositories accepted by the existing marketplace parser become publishable; standalone MCP servers remain excluded.
- The initial page-request cap is enforced, exceeded work remains visible and resumable, and no capped/incomplete partition is marked complete.
- `inspect` and run summaries expose source freshness, bounded coverage, candidate yield, and incomplete work separately from overall crawl success.

## Rebase onto the 2026-10-30 workspace main

- The crawler files live under `awesomeclaudeplugins.com/crawler/` in the npm workspace. Existing shared contracts and main-branch behavior must remain intact.
- After #404, main uses SQLite schema v16 for catalog metadata (license and archived); v14/v15 remain its catalog timestamp and plugin-summary migrations. Repository Search adds tables in v17, the page cursor in v18, and rejected candidate cache in v19. Existing populated v16 databases must upgrade to v19 without losing catalog metadata, original timestamps, plugin summaries, or Code Search checkpoints.
- Before production backfill: verify a full 20-request bounded crawler dry-run against an isolated database copy, review candidate yield and backlog movement, and check the newest CI results. Production backfill remains intentionally disabled until explicitly approved.
