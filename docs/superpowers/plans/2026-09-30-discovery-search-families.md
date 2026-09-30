# Multi-family GitHub Code Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand discovery to run the two approved GitHub Code Search query families with independent adaptive caches and family-aware warnings.

**Architecture:** Define the ordered family IDs and query builders once, then pass the family through discovery, storage, logs, and summaries. Migrate existing partitions to the current family, keep independent cache coverage for each family, and run the existing enrichment phase once over the whole repository table after discovery.

**Tech Stack:** TypeScript (Node `>=24 <25`), SQLite via `better-sqlite3`, Vitest, Biome.

**Spec:** [2026-09-30-discovery-search-families-design.md](../specs/2026-09-30-discovery-search-families-design.md)

## Global Constraints

- Run `marketplace_filename_path` -> `marketplace_path_literal` sequentially on every crawl over the adaptive root range `0..400000`.
- Preserve the exact query templates in the spec and the existing pagination, retry, saturation, short-page, and splitting behavior.
- Use a shared case-insensitive URL set across all families and ranges; count and upsert each URL once per crawl.
- Keep one enrichment phase after discovery; it processes the full `repositories` table, including rows from earlier crawls.
- Keep adaptive range caches independent per family; migrate old ranges to `marketplace_filename_path` and preserve that family's previous cache when coverage is incomplete.
- Persist `query_family` on search warnings; leave it `NULL` for pre-migration rows and non-search errors.
- Continue after partial or temporary family failures; fail with `no_successful_ranges` only when no family processes any range successfully. Preserve fatal GitHub API behavior.
- Do not add a recurring live GitHub API test or a seed for `mnemoverse/claude-plugin`; the user will check that repository manually after rollout.

## Follow-up review correction

The REST `/search/code` endpoint searches file contents only when `in:` is omitted. The `marketplace_path_literal` query includes `in:path`, `SearchPage` validates and retains each hit's path, and discovery accepts that family's hits only when the path is exactly `.claude-plugin/marketplace.json`. Tests cover content-only matches, nested paths, and case variants.

## File Map

- Create `crawler/src/github/searchFamilies.ts` for stable family IDs, order, and exact query builders; modify `crawler/src/github/client.ts` to retain validated Code Search paths.
- Modify `crawler/src/crawl/discover.ts` and `discover.test.ts` to run families, share dedupe state, and report family-specific warnings and counts.
- Modify `crawler/src/storage/schema.ts` and `schema.test.ts` for schema version 12 and migration of cached ranges and errors. The base branch already uses version 11 for marketplace-cache invalidation.
- Modify `crawler/src/storage/discoveryRanges.ts` and `discoveryRanges.test.ts` for family-scoped cache reads and replacement.
- Modify `crawler/src/storage/runs.ts` and `runs.test.ts` to persist nullable `query_family` on run errors.
- Modify `crawler/src/crawl/runCrawl.ts`, `runCrawl.test.ts`, `crawler/src/service/execute.ts`, and `execute.test.ts` for aggregate logging, persisted report validation, and end-to-end behavior.

## Review Focus

- A saturated split must update aggregate and owning-family range counts consistently. Test in Task 3: split one family and assert aggregate counts equal the sum of its two family counts.
- A successful empty result still counts as a successful family range and permits its full cache to be saved. Test in Task 3.
- A temporary failure in one family must preserve that family's prior cache while later families continue. Test in Task 3.
- A fatal 401/422 in a later family must remain fatal, include that family in the failure log, and prevent later searches and enrichment. Test in Task 4.
- A stored report from the previous version has no family fields; normalize it as the old `marketplace_filename_path`-only crawl so publish/recovery can still read it. Test in Task 4.

---

### Task 1: Define the ordered search families

**Files:**
- Create: `crawler/src/github/searchFamilies.ts`
- Create: `crawler/src/github/searchFamilies.test.ts`

**Interfaces:**
- Produces `DiscoveryQueryFamily`, the ordered `discoverySearchFamilies` list, and `buildQuery(range: SizeRange): string` on each family entry.
- IDs and order: `marketplace_filename_path`, `marketplace_path_literal`.

- [x] **Step 1: Write the failing family table test**

In `searchFamilies.test.ts`, assert the exact ordered IDs and query strings for `[12, 34]`:

```text
filename:marketplace.json path:.claude-plugin size:12..34
.claude-plugin/marketplace.json in:path size:12..34
```

- [x] **Step 2: Run the focused test and confirm it fails**

Run from `crawler/`: `npm exec vitest run src/github/searchFamilies.test.ts`

Expected: FAIL because the family module does not exist.

- [x] **Step 3: Implement the ordered family definitions**

Export the stable ID type and an ordered array whose `buildQuery` functions produce the two exact templates. Keep query construction in this module so discovery and tests use the same definitions.

- [x] **Step 4: Run the focused test**

Run from `crawler/`: `npm exec vitest run src/github/searchFamilies.test.ts`

Expected: PASS for all IDs, query strings, and order.

- [x] **Step 5: Commit**

```bash
git add crawler/src/github/searchFamilies.ts crawler/src/github/searchFamilies.test.ts
git commit -m "feat: define discovery search families"
```

### Task 2: Persist independent family caches and warning IDs

**Files:**
- Modify: `crawler/src/storage/schema.ts`
- Modify: `crawler/src/storage/schema.test.ts`
- Modify: `crawler/src/storage/discoveryRanges.ts`
- Modify: `crawler/src/storage/discoveryRanges.test.ts`
- Modify: `crawler/src/storage/runs.ts`
- Modify: `crawler/src/storage/runs.test.ts`
- Modify: `crawler/src/crawl/discover.ts` (pass the existing family ID until Task 3 replaces the single-family loop)

**Interfaces:**
- Consumes `DiscoveryQueryFamily` from Task 1.
- Change cache signatures to `listCachedDiscoveryRanges(db, queryFamily, root)` and `replaceCachedDiscoveryRanges(db, queryFamily, root, ranges)`.
- Add optional nullable `query_family: DiscoveryQueryFamily | null` to `RunErrorInput`; return it as nullable on `RunErrorRow`.

- [x] **Step 1: Write migration and family-isolation tests**

Seed a version-10 database with a split `discovery_ranges` partition and an old `run_errors` row. After migration, assert schema version 12, unchanged range bounds assigned to `marketplace_filename_path`, and old `query_family` is `NULL`. Add a cache test storing different partitions for the same root under two family IDs and assert reads/replacements stay isolated.

- [x] **Step 2: Run the focused tests and confirm they fail**

Run from `crawler/`: `npm exec vitest run src/storage/schema.test.ts src/storage/discoveryRanges.test.ts src/storage/runs.test.ts`

Expected: FAIL because the schema and cache APIs have no family dimension.

- [x] **Step 3: Implement schema version 12 and storage APIs**

Rebuild `discovery_ranges` with primary key `(query_family, root_start, root_end, range_start, range_end)` and copy every existing row as `marketplace_filename_path`. Add nullable `run_errors.query_family`; make `recordRunError` store a family when supplied and `NULL` otherwise. Scope exact-partition reads and replacements to the family argument.
Keep the current discovery caller compiling by passing `marketplace_filename_path`; Task 3 replaces this transitional use with the family loop.

- [x] **Step 4: Run focused storage tests**

Run from `crawler/`: `npm exec vitest run src/storage/schema.test.ts src/storage/discoveryRanges.test.ts src/storage/runs.test.ts`

Expected: PASS; existing migration assertions now expect version 12, prior cache bounds are preserved, and family caches do not overlap.

- [x] **Step 5: Commit**

```bash
git add crawler/src/storage/schema.ts crawler/src/storage/schema.test.ts crawler/src/storage/discoveryRanges.ts crawler/src/storage/discoveryRanges.test.ts crawler/src/storage/runs.ts crawler/src/storage/runs.test.ts crawler/src/crawl/discover.ts docs/superpowers/plans/2026-09-30-discovery-search-families.md
git commit -m "feat: persist discovery query families"
```

### Task 3: Run sequential family discovery with shared dedupe

**Files:**
- Modify: `crawler/src/crawl/discover.ts`
- Modify: `crawler/src/crawl/discover.test.ts`
- Update: aggregate discovery-count expectations in `crawler/src/crawl/runCrawl.test.ts`, `crawler/src/service/execute.test.ts`, and `crawler/test/cli.test.ts`

**Interfaces:**
- Consumes `discoverySearchFamilies` from Task 1 and family-scoped cache/error APIs from Task 2.
- Add `query_family` to each `DiscoveryWarning` and search warning log. Add `families: Record<DiscoveryQueryFamily, { successfulRanges: number; warningCount: number }>` to `DiscoverySummary`.

- [x] **Step 1: Write the family discovery tests**

Add tests asserting: exact calls run #2 -> #1 for the same root; an empty successful response counts and saves that family's full cache; case-variant duplicates across families are counted and upserted once; a temporary error in one family leaves its seeded cache intact and the other family runs; warnings carry `query_family` in the DB row, summary, and log; a saturated split updates the aggregate and owning-family counts together.

- [x] **Step 2: Run discovery tests and confirm the new cases fail**

Run from `crawler/`: `npm exec vitest run src/crawl/discover.test.ts`

Expected: FAIL because discovery still builds only the current query and summaries have no family fields.

- [x] **Step 3: Implement the family loop and scoped coverage**

Loop through `discoverySearchFamilies` in declared order, then through configured root ranges. Use family-scoped cache reads/writes and a fresh coverage state per family/root. Keep one `countedUrls` set across the whole crawl; skip a previously seen lowercase URL before lookup/upsert/counting. Update both aggregate and per-family counters on range success, split, and warning.

- [x] **Step 4: Run focused discovery tests**

Run from `crawler/`: `npm exec vitest run src/crawl/discover.test.ts src/storage/discoveryRanges.test.ts`

Expected: PASS; one family's temporary failure does not block subsequent families, and incomplete coverage does not replace its cached partition.

- [x] **Step 5: Commit**

```bash
git add crawler/src/crawl/discover.ts crawler/src/crawl/discover.test.ts crawler/src/crawl/runCrawl.test.ts crawler/src/service/execute.test.ts crawler/test/cli.test.ts docs/superpowers/plans/2026-09-30-discovery-search-families.md
git commit -m "feat: search all discovery query families"
```

### Task 4: Expose family totals and preserve crawl/report behavior

**Files:**
- Modify: `crawler/src/crawl/runCrawl.ts`
- Modify: `crawler/src/crawl/runCrawl.test.ts`
- Modify: `crawler/src/service/execute.ts`
- Modify: `crawler/src/service/execute.test.ts`

**Interfaces:**
- Consumes the family-aware `DiscoverySummary` from Task 3.
- New crawl reports require the family totals; stored reports from earlier versions remain readable and are interpreted as `marketplace_filename_path`-only runs.

- [x] **Step 1: Write the crawl integration and legacy-report tests**

Assert both searches finish before enrichment starts, and enrichment still visits both a repository already stored before this crawl and a newly discovered repository. Assert the discovery phase-completed log includes family totals, one successful family lets the crawl continue despite the other failing, and zero successful ranges across both families still yields `no_successful_ranges`. Add a fatal 422 test from `marketplace_path_literal` that asserts the error remains fatal, the failure log identifies the family, and enrichment is skipped. Add a stored-report test with the old summary shape and assert it is still accepted during publish/recovery.

- [x] **Step 2: Run focused integration tests and confirm the new assertions fail**

Run from `crawler/`: `npm exec vitest run src/crawl/runCrawl.test.ts src/service/execute.test.ts`

Expected: FAIL because only one query is run and report validation does not understand family totals.

- [x] **Step 3: Implement summary propagation and backward-compatible report parsing**

Add the family totals to the discovery completion log. Keep the existing single enrichment call and full-table iterator unchanged. Validate family keys/counts and warning `query_family` in new reports; when loading a legacy stored report without those fields, assign its aggregate counts and warnings to `marketplace_filename_path` and zero to `marketplace_path_literal`.

- [x] **Step 4: Run focused tests and the full unit suite**

Run from `crawler/`:

```bash
npm exec vitest run src/crawl/runCrawl.test.ts src/service/execute.test.ts
npm test
npm run typecheck
```

Expected: PASS; all existing crawl, persistence, and publication tests remain green, including legacy report recovery.

- [x] **Step 5: Commit**

```bash
git add crawler/src/crawl/runCrawl.ts crawler/src/crawl/runCrawl.test.ts crawler/src/service/execute.ts crawler/src/service/execute.test.ts
git commit -m "feat: report discovery results by query family"
```
