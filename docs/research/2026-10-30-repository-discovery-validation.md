# Local validation: missing marketplace discovery (PR #405)

This is the release gate for the `missing` branch; **do not merge or enable production backfill until this is checked**.

## Scope and safety

- The feature adds bounded GitHub Repository Search alongside Code Search. It is not a globally exhaustive GitHub index.
- Repository Search is capped at **20 HTTP attempts per crawl**, reserving up to five for historical work when due. **This is not a cap on all GitHub API calls or total wall time**: the existing Code Search and enrichment may take longer.
- A `--dry-run` disables publication, **but writes scan checkpoints, candidates and status into `DB_PATH`**. Never point it at a live database; use a separate, disposable file or a verified isolated copy.
- `PUBLISH_ENABLED=false`; do not supply `GITHUB_PUBLISH_TOKEN`, Telegram credentials or Railway runtime variables for the local test. A GitHub **read-only** token is still required to search.
- Keep production backfill disabled. The local audit should not create an allow-list for known missing repositories.

## 1. Prepare and run offline tests

Use **Node.js 24.22.2** and the npm workspace in `awesomeclaudeplugins.com/`.

```bash
git fetch origin
git switch missing
git pull --ff-only origin missing
cd awesomeclaudeplugins.com
npm ci
npm run smoke:sqlite --workspace=catalog-crawler
npm run typecheck --workspace=catalog-crawler
npm run lint --workspace=catalog-crawler
npm run test --workspace=catalog-crawler
npm run typecheck:integration --workspace=catalog-crawler
npm run test:integration --workspace=catalog-crawler
```

The crawler tests cover capped pagination, saved next-page cursors, retry/reset behavior, temporal partitions, deduplication, source coverage and SQLite schema migration v15 → v17. Re-run these before investigating any live API mismatch.

## 2. Bounded local end-to-end dry-run

Create a disposable database path, or first make a consistent, isolated snapshot of a representative existing database (including its WAL state if applicable). **Do not run against a mounted Railway volume or an actively written SQLite file.**

From `awesomeclaudeplugins.com/` on Bash:

```bash
set -euo pipefail
mkdir -p .local
export DB_PATH="$PWD/.local/discovery-audit.sqlite"
export PUBLISH_ENABLED=false
# Export a read-only GITHUB_READ_TOKEN securely (do not commit it or paste it into logs).
npm run crawl --workspace=catalog-crawler -- --dry-run | tee .local/discovery-audit.log
npm run inspect --workspace=catalog-crawler | tee .local/discovery-inspect.json
```

On PowerShell, after `New-Item -Force -ItemType Directory .local`:

```powershell
$env:DB_PATH = (Join-Path (Get-Location) '.local/discovery-audit.sqlite')
$env:PUBLISH_ENABLED = 'false'
# Set GITHUB_READ_TOKEN through your usual local secret manager/environment.
npm run crawl --workspace=catalog-crawler -- --dry-run | Tee-Object -FilePath .local/discovery-audit.log
if ($LASTEXITCODE -ne 0) { throw "Crawler failed with exit code $LASTEXITCODE" }
npm run inspect --workspace=catalog-crawler | Tee-Object -FilePath .local/discovery-inspect.json
if ($LASTEXITCODE -ne 0) { throw "Inspect failed with exit code $LASTEXITCODE" }
```

Run it **at least twice on the same disposable DB** to check continuation and fair progress. Repeat on a different UTC date if checking shifted rolling windows. Stop if errors or API-budget usage are abnormal; stopping a run leaves incomplete checkpoints to be retried.

## 3. Collect evidence before merge

Record for each run:

| Signal | Pass condition |
| --- | --- |
| Repository Search attempts | Never more than 20 actual requests in one crawl |
| Checkpoints | Completed leaves have no pending pages; interrupted leaves resume from stored `next_page` |
| Fair scheduling | Rolling work progresses; when historical work is due, its reserved budget is respected |
| Candidate funnel | Raw results, unique new URLs, accepted marketplaces, rejected/non-plugin candidates and deferrals reported separately |
| Catalog integrity | Existing canonical repositories, plugin counts/identities, shared parser output and publication preview do not regress |
| Coverage clarity | `inspect` shows incomplete/stale partitions and never claims all GitHub repositories were enumerated |
| API behavior | Retry-After, search quotas, errors and runtime are acceptable for normal scheduled crawls |

The earlier focused generic-query check retrieved `human-stuff/prodready`; another isolated page-2 cursor check retrieved `mnemoverse/claude-plugin`. Neither is manually seeded in production. **Do not claim normal full-crawl scheduler reachability until verified by the bounded multi-run audit**; reaching the relevant partition may require multiple scheduled runs.

## 4. Merge and rollout gates

- [ ] CI on the final commit passes: typecheck, lint, tests and integration contracts.
- [ ] All actionable human/CodeRabbit/CodeFactor review comments are resolved.
- [ ] Local bounded multi-run dry-run evidence is recorded in the PR.
- [ ] DB upgrade from production v15 to v17 verified on an isolated copy; lastmod/catalog data unchanged.
- [ ] No unexplained changes to catalog identities, plugin counts or indexability.
- [ ] Mark the draft PR ready and merge only after those gates pass.
- [ ] **Separate approval** to enable production discovery and any historical backfill; watch rate budget, backlog age, accepted marketplace yield and failure rate.

Out of scope for PR #405: a full GitHub public-repository ID feed, unbounded historical backfill, hard-coded missing repositories, or claims of complete GitHub-wide coverage.
