# Railway directory cutover (mandatory before merging directory-layout PR)

This repository is deployed as two Railway services in project `acp`. They currently build from `/ui` and `/crawler`. Those paths disappear when this PR is merged: **merging without coordinating Railway will break subsequent builds/deployments.** No live Railway configuration is changed by this pull request.

## Cutover for this directory-only PR

1. Record current production release and verify a rollback path. Temporarily turn off automatic deployments for the UI and crawler, or otherwise prevent a deploy from starting between the Git merge and configuration changes. Do not make new root-directory settings effective while `main` still uses the old layout.
2. Merge this PR into `main`.
3. In Railway project `acp`, update both services **before starting new deployments**:
   - UI (`awesome-claude-plugins`): Source Root Directory `/awesomeclaudeplugins.com/ui`; Watch Patterns `/awesomeclaudeplugins.com/ui/**` (also include `/awesomeclaudeplugins.com/shared/**` after PR #378). Keep the existing Railpack build/start behavior for this step.
   - Crawler (`crawler`): Source Root Directory `/awesomeclaudeplugins.com/crawler`; Build Command `npm ci && npm run build`; Start Command `node dist/cli.js crawl`; Watch Patterns `/awesomeclaudeplugins.com/crawler/**`. Preserve cron schedule, variables, and the `/data` volume.
4. Deploy and verify the UI and crawler from their new roots. Check UI page/health, catalog version, crawler's next scheduled execution, GitHub catalog publication to `awesomeclaudeplugins.com/ui/src/data/*.json`, and IndexNow workflow triggers.
5. Re-enable automatic deployment only after both services are healthy. Roll back by restoring the old `main` revision together with the old Railway root directories and watch patterns; avoid reverting code alone.

## Subsequent PR #378 (npm workspace)

PR #378 changes the installation topology. Before merging it, migrate **both** Railway services from app-specific roots to Source Root Directory `/awesomeclaudeplugins.com`, using the one root workspace lockfile. Set explicit app-specific commands: UI build `npm ci && npm run build:ui`, UI start `npm run start:ui`; crawler build `npm ci && npm run build:crawler`, crawler start `npm run start:crawler`. Watch patterns must include the root manifests, `shared/**`, and the respective application directory. Verify the Node runtime and existing volume/cron behavior. As with the first migration, coordinate the config switch and merge to prevent incompatible intermediate builds.
