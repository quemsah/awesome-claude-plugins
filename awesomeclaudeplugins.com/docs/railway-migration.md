# Railway directory cutover for PR #392

The Railway project `acp` has two production services deployed from GitHub `main`.
The live revision before this change uses `/ui` and `/crawler`.
**Do not merge #392 and leave Railway pointing to those paths.**

## Phase 1 — #392 (directory move only; no npm workspaces)

The production Railway environment has a **staged, unapplied** configuration for this cutover.
It must not be applied while `main` still has the old directory layout. Verify the staged
diff in Railway before applying it: it may have been edited since this checklist was written.

| Setting | UI (`awesome-claude-plugins`) | Crawler (`crawler`) |
| --- | --- | --- |
| Root Directory | `/awesomeclaudeplugins.com/ui` | `/awesomeclaudeplugins.com/crawler` |
| Builder | Railpack | Railpack |
| Build Command | `npm ci && npm run build` | `npm ci && npm run build` |
| Start Command | `npm run start` | `node dist/cli.js crawl` |
| Watch Patterns | `/awesomeclaudeplugins.com/ui/**` | `/awesomeclaudeplugins.com/crawler/**` |

The crawler retains its existing `/data` persistent volume, cron schedule,
restart policy, and all environment variables. UI domains and tokens are unchanged.
App-specific lockfiles remain the install sources for #392.

### Cutover sequence

1. Confirm #392 is green, the crawler's latest run is settled, and a known-good
   production deployment is available for rollback. In Railway, **pause automatic
   GitHub deployments for both services** (this toggle is separate from the staged
   root-directory change). Avoid cutting over while the scheduled crawler is running.
2. Inspect the production environment's pending Railway changes. They should consist
   only of the root/build/start/watch settings above (and any harmless existing builder
   setting). **Do not apply a previous `/` workspace-root patch** or any stale
   `/packages/catalog-contract/**` watch patterns; those belong to an older design.
3. Merge #392 into `main`. Keep automatic deployment paused. Check that the new
   paths and both app-specific lockfiles exist at the merged commit.
4. **Immediately apply the already-staged Railway configuration as one environment
   change** and deploy both services from that new `main` revision. Do not publish
   new catalog data while the UI is still on an incompatible deployment.
5. Verify the UI custom domain, a detail page, `/api/catalog-version`, and
   `/sitemap.xml`; check the crawler build, `/data` mount, and its next cron
   execution. Confirm the crawler publishes into
   `awesomeclaudeplugins.com/ui/src/data/{repos,stats,markdown-paths}.json` and
   still updates the repository-root `README.md`. Verify GitHub Actions CI and
   IndexNow run when `repos.json` changes.
6. Re-enable automatic deployments for both services only after successful checks.

**Rollback:** If a deployment fails, restore the old `main` revision **and**
restore the old Railway UI/crawler roots (`/ui` and `/crawler`), build/start
settings, and watch patterns together. Do not roll back code alone. Do not delete
the crawler volume or change secrets during the cutover.

## Phase 2 — PR #378 (shared npm workspace; separate cutover)

#378 introduces the workspace root under `awesomeclaudeplugins.com/` and
`shared/catalog-contract`. Do not use its build/start commands for #392.
After #392 and #369 have been merged and deployed successfully:

1. Stage the second Railway change separately for both services:
   - Root Directory `/awesomeclaudeplugins.com` for **both**.
   - UI: build `npm ci && npm run build:ui`; start `npm run start:ui`.
   - Crawler: build `npm ci && npm run build:crawler`; start `npm run start:crawler`.
   - UI watch patterns: `/awesomeclaudeplugins.com/ui/**`,
     `/awesomeclaudeplugins.com/shared/**`, `/awesomeclaudeplugins.com/package.json`,
     `/awesomeclaudeplugins.com/package-lock.json`.
   - Crawler watch patterns: `/awesomeclaudeplugins.com/crawler/**`,
     `/awesomeclaudeplugins.com/shared/**`, `/awesomeclaudeplugins.com/package.json`,
     `/awesomeclaudeplugins.com/package-lock.json`.
2. Confirm those workspace scripts and the root lockfile exist in the final #378
   diff. Pause automatic GitHub deployments, merge #378, and apply the second
   staged change as a coordinated cutover.
3. Verify Node.js version, both builds, cron, persistent volume, catalogue
   publication and UI runtime. Restore auto deployments only after verification.
