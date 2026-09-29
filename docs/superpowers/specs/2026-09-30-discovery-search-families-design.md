# Multi-family GitHub Code Search in Discovery

**Status:** Approved conversational design; implementation plan pending.

## Goal

Increase repository discovery coverage by searching GitHub Code Search with three query forms. Code Search does not index or return every repository, so alternate query forms can surface candidates that the current query misses. This is a coverage improvement, not a guarantee that any particular repository will be returned.

## Search families

Run all families on every crawl, sequentially, over the existing adaptive size domain `0..400000`:

| Run order | Stable family ID | Query template |
| --- | --- | --- |
| First (n8n #2) | `marketplace_filename_path` | `filename:marketplace.json path:.claude-plugin size:<min>..<max>` |
| Second (n8n #1) | `marketplace_path_literal` | `.claude-plugin/marketplace.json size:<min>..<max>` |
| Third (n8n #3) | `claude_plugin_path` | `path:.claude-plugin size:<min>..<max>` |

The order preserves the current query first and runs the broadest path-only query last. Each family uses the current pagination, retry, saturation, short-page, and adaptive range-splitting behavior. Queries share the existing GitHub Code Search rate budget and run sequentially.

## Candidate flow

- Merge candidates from all families into the existing discovery pipeline.
- Deduplicate case-insensitively by repository URL across families and size ranges. Count and upsert each repository once per crawl.
- Enrich the merged candidate set once, after all three discovery sweeps.
- Keep the existing enrichment and marketplace validation rules. A candidate found by the broad path-only family is still removed or rejected by the current checks if it does not have a valid marketplace.

## Adaptive range cache and migration

Add a `query_family` dimension to persisted discovery partitions. Rebuild `discovery_ranges` in one schema migration so its key is `(query_family, root_start, root_end, range_start, range_end)` and its partition checks are scoped to a family.

Migrate existing range rows to `marketplace_filename_path`, preserving the learned partition for the current query. The two added families start with the full root range and learn their own partitions. Replace a family's cache only after that family's search completes with exact coverage; keep its previous cache if the sweep is incomplete.

Add nullable `query_family` to `run_errors` in the same migration. Existing rows and non-discovery errors keep `NULL`.

## Warnings and completion

- Include `query_family` in search warning records, structured logs, and discovery summary warnings. Include per-family successful-range and warning totals in the summary; aggregate `newUrls` and `existingUrls` remain counts of the deduplicated union.
- Preserve current best-effort semantics. An incomplete or temporarily failed range records a family-specific warning; the crawler continues with remaining ranges and families.
- `successfulRanges` is the total across all families. The existing `no_successful_ranges` failure remains when no family processes any range successfully. Otherwise, incomplete families do not by themselves fail the crawl.
- Preserve existing fatal GitHub API error behavior.

## Verification

Add deterministic tests for:

1. Exact query construction for all three families and sequential execution in the specified order.
2. Independent adaptive splits and cache reads/writes per family.
3. Schema migration assigning existing cached ranges to `marketplace_filename_path`, preserving those ranges, and storing query-family warnings.
4. Case-insensitive deduplication when the same repository appears in multiple families and size ranges.
5. A partial or temporarily failed family emitting a family-specific warning, retaining its previous cache, and allowing the other families to continue.
6. One enrichment pass after the merged discovery results.

Do not add a live GitHub API test or a seed/allowlist for `mnemoverse/claude-plugin`. After rollout, manually check whether that repository appears in the catalog after about one week.

## Operational impact and scope

The two additional query families add Code Search requests and may extend discovery duration; the exact increase depends on result density and adaptive splitting. Sequential execution avoids introducing concurrent pressure on the shared rate budget.

This change does not alter marketplace validation, enrich repositories more than once, or guarantee discovery when GitHub Code Search omits a repository from its results.
