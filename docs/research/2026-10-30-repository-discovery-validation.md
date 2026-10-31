# Local validation: missing marketplace discovery (PR #405)

This is the release gate for the `missing` branch; **do not merge or enable production backfill until this is checked**.

## Scope and safety

- The feature adds bounded GitHub Repository Search alongside Code Search. It is not a globally exhaustive GitHub index.
- Repository Search is capped at **20 HTTP attempts per crawl**, reserving up to five for historical work when due. **This is not a cap on all GitHub API calls or total wall time**: the existing Code Search and enrichment may take longer.
- A `--dry-run` disables publication, **but writes scan checkpoints, candidates and status into `DB_PATH`**. Never point it at a live database; use a separate, disposable file or a verified isolated copy.
- `PUBLISH_ENABLED=false`; do not supply `GITHUB_PUBLISH_TOKEN`, Telegram credentials or Railway runtime variables for the local test. A GitHub **read-only** token is still required to search.
- Repository Search is **off by default**. Set `REPOSITORY_SEARCH_ENABLED=true` only in this isolated audit; do not enable it in Railway or production without separate approval.
- Keep production backfill disabled. The local audit should not create an allow-list for known missing repositories.

## 1. Prepare and run offline tests

Use **Node.js 24.22.2**, **Bun 1.4.4** and the workspace in `awesomeclaudeplugins.com/`.

```bash
git fetch origin
git switch missing
git pull --ff-only origin missing
cd awesomeclaudeplugins.com
bun install --frozen-lockfile
bun --filter catalog-crawler smoke:sqlite
bun --filter catalog-crawler typecheck
bun --filter catalog-crawler lint
bun --filter catalog-crawler test
bun --filter catalog-crawler typecheck:integration
bun --filter catalog-crawler test:integration
```

The crawler tests cover capped pagination, saved next-page cursors, retry/reset behavior, temporal partitions, deduplication, source coverage and SQLite schema migrations through v19, including the populated #404 v16 → v19 upgrade. Re-run these before investigating any live API mismatch.

**Merge-order dependency satisfied:** #404 was merged into `main` and integrated into #405 in commit `036f8b7`. The #404 metadata migration remains v16; Repository Search uses v17 (partitions), v18 (page cursor), and v19 (rejected-candidate cache). The populated v16 → v19 regression test is part of #405. The separate production-data-copy audit remains a pre-merge gate.

## 2. Bounded local end-to-end dry-run

Create a disposable database path, or first make a consistent, isolated snapshot of a representative existing database (including its WAL state if applicable). **Do not run against a mounted Railway volume or an actively written SQLite file.**

From `awesomeclaudeplugins.com/` on Bash:

```bash
set -euo pipefail
mkdir -p .local
export DB_PATH="$PWD/.local/discovery-audit.sqlite"
export PUBLISH_ENABLED=false
export REPOSITORY_SEARCH_ENABLED=true
# Export a read-only GITHUB_READ_TOKEN securely (do not commit it or paste it into logs).
bun --filter catalog-crawler crawl --dry-run | tee .local/discovery-audit.log
bun --filter catalog-crawler inspect | tee .local/discovery-inspect.json
```

On PowerShell, after `New-Item -Force -ItemType Directory .local`:

```powershell
$env:DB_PATH = (Join-Path (Get-Location) '.local/discovery-audit.sqlite')
$env:PUBLISH_ENABLED = 'false'
$env:REPOSITORY_SEARCH_ENABLED = 'true'
# Set GITHUB_READ_TOKEN through your usual local secret manager/environment.
bun --filter catalog-crawler crawl --dry-run | Tee-Object -FilePath .local/discovery-audit.log
if ($LASTEXITCODE -ne 0) { throw "Crawler failed with exit code $LASTEXITCODE" }
bun --filter catalog-crawler inspect | Tee-Object -FilePath .local/discovery-inspect.json
if ($LASTEXITCODE -ne 0) { throw "Inspect failed with exit code $LASTEXITCODE" }
```

Run it **at least twice on the same disposable DB** to check continuation and fair progress. Repeat on a different UTC date if checking shifted rolling windows. Stop if errors or API-budget usage are abnormal; stopping a run leaves incomplete checkpoints to be retried.

### Explicit bounded expired-window reconciliation

An expired unfinished pushed window is stored as a distinct exact date range with its pagination cursor; `inspect` reports every still-unverified window as a gap. **Ordinary scheduled crawls never replay expired windows automatically.** After examining these gaps and obtaining separate approval for backfill, use the same isolated database and read-only token:

```bash
bun --filter catalog-crawler crawl --dry-run --reconcile-expired-gaps
bun --filter catalog-crawler inspect
```

The flag is accepted only with `--dry-run` and `REPOSITORY_SEARCH_ENABLED=true`. This command uses the standard **20 Repository Search HTTP attempts per run** and persists progress for the next explicitly requested replay. A gap is removed **only after a successful page-one-verified scan**; saturated windows are split into exact smaller ranges. Repeat under operator control until verified or investigate any remaining gaps. A dry run writes to `DB_PATH` but never publishes. Never use a production or actively written database for this audit.

## 3. Collect evidence before merge

Record for each run:

| Signal | Pass condition |
| --- | --- |
| Repository Search attempts | Never more than 20 actual requests in one crawl |
| Checkpoints | Interrupted leaves may resume from `next_page`, but they remain incomplete until a full fresh scan starting at page 1 verifies coverage; reordering must never produce a false complete status |
| Fair scheduling | Rolling work progresses; when historical work is due, its reserved budget is respected |
| Candidate funnel | Raw results, unique new URLs, accepted marketplaces, rejected/non-plugin candidates and deferrals reported separately |
| Catalog integrity | Existing canonical repositories, plugin counts/identities, shared parser output and publication preview do not regress |
| Coverage clarity | `inspect` retains exact expired rolling gaps until the explicitly enabled bounded replay verifies each; unreconciled gaps keep freshness incomplete |
| API behavior | Retry-After, search quotas, errors and runtime are acceptable for normal scheduled crawls |

The earlier focused generic-query check retrieved `human-stuff/prodready`; another isolated page-2 cursor check retrieved `mnemoverse/claude-plugin`. Neither is manually seeded in production. **Do not claim normal full-crawl scheduler reachability until verified by the bounded multi-run audit**; reaching the relevant partition may require multiple scheduled runs.

## 4. Merge and rollout gates

- [ ] CI on the final commit passes: typecheck, lint, tests and integration contracts.
- [ ] All actionable human/CodeRabbit/CodeFactor review comments are resolved.
- [ ] Local bounded multi-run dry-run evidence is recorded in the PR.
- [ ] DB upgrade from a populated #404 v16 database to the final #405 v19 schema verified on an isolated copy; lastmod, license, archived flags and catalog data unchanged.
- [ ] Confirm `rejected_repository_candidates` exists after v16 → v19, and inspect unresolved expired rolling gaps; if any exist, plan and verify a bounded replay before declaring the configured sweep complete.
- [ ] No unexplained changes to catalog identities, plugin counts or indexability.
- [ ] Mark the draft PR ready and merge only after those gates pass.
- [ ] **Separate approval** to enable production discovery and any historical backfill; watch rate budget, backlog age, accepted marketplace yield and failure rate.

Out of scope for PR #405: a full GitHub public-repository ID feed, unbounded historical backfill, hard-coded missing repositories, or claims of complete GitHub-wide coverage.
