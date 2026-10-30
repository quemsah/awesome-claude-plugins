# Railway npm workspace migration (PR #378)

> Production safety gate. The workspace refactor must **not** be merged into
> `main` until the source changes, Railway settings, and dependent catalog
> contracts can be released together. This is a runbook, not permission to deploy.

## Verified current production configuration (2026-10-30)

| Service | Root directory | Builder | Build | Start | Watch paths |
| --- | --- | --- | --- | --- | --- |
| UI (`awesome-claude-plugins`) | `/ui` | Railpack | auto-detected | auto-detected | `/ui/**` |
| `crawler` | `/crawler` | Railpack | `npm ci && npm run build` | `node dist/cli.js crawl` | `/crawler/**` |

Both use `main`. The crawler uses the `0 21 * * *` cron schedule,
`NEVER` restart policy, and a persistent volume mounted on `/data`.
Do not change its volume, environment variables, cron, or service identity.

## Required target settings

All build and start commands run **from the repository root** (not from
`ui/` or `crawler/`); the root `package-lock.json` and
`packages/catalog-contract/` must be visible at install, build, and runtime.

| Setting | UI | Crawler |
| --- | --- | --- |
| Root directory | `/` | `/` |
| Builder | `RAILPACK` | `RAILPACK` |
| Build command | `npm ci --workspace=awesome-claude-plugins --include-workspace-root=false && npm run build:ui` | `npm ci --workspace=catalog-crawler --include-workspace-root=false && npm run build:crawler` |
| Start command | `npm run start:ui` | `npm run start:crawler` |
| Watch patterns | `/ui/**`, `/packages/catalog-contract/**`, `/package.json`, `/package-lock.json` | `/crawler/**`, `/packages/catalog-contract/**`, `/package.json`, `/package-lock.json` |

If a root `.npmrc` is introduced, also add `/.npmrc` to both watch-pattern
lists. Watch patterns are evaluated from the *repository root* even when a
service root directory is set. If build input beyond these paths changes,
add that input to the corresponding watch patterns.

Build commands intentionally use targeted `npm ci` with the shared
lockfile. The root package scripts select the correct workspace. In
particular, invoking `node dist/cli.js crawl` from the repository root is
incorrect; the crawler entrypoint is under `crawler/dist/`.

## Coordinated release order

1. Merge PR #369 (marketplace parser contract) **before** PR #378, or
   intentionally retain #378's stacked base until its dependency is ready.
2. Reconcile #378 against current `main`: PR #367 removed `html_url` /
   `owner_url` from the published snapshot, PR #370 added
   `catalog_updated_at`, and PR #352 adds optional `plugins` summaries.
   The shared package's **strict published-record validator**, crawler
   snapshot writer and integration tests must agree on the final version.
   Preserve the more permissive nullable UI display `Repo` type.
3. Require green UI and crawler CI on the final merge candidate, including
   an actual production-style UI build and crawler integration tests. Check
   that the root lockfile resolves all three workspaces using
   `npm ci --workspace=awesome-claude-plugins --include-workspace-root=false`
   and `npm ci --workspace=catalog-crawler --include-workspace-root=false`.
4. Stage *both* Railway target configurations and verify the staged diff.
   **Do not accept/apply them while `main` still uses the old isolated
   package layout**: that would rebuild the old revision from incompatible
   settings.
5. Schedule a controlled release (avoid the 21:00 UTC crawler cron window),
   coordinate merging #378 and accepting both staged Railway changes, and
   watch both deployments. Because GitHub merge and Railway config commit
   are two separate operations, there is no atomic cutover; a build may be
   attempted during the transition. The previously healthy deployment should
   remain available if a new build fails, but do not rely on a zero-error
   transition. If strict zero-build-failure is required, first land a separate
   backward-compatible preparation release that can build with both old and
   new Railway settings.
6. Verify UI endpoints, including `/api/catalog` and `/sitemap.xml`;
   ensure the UI can read `ui/src/data/repos.json`. Check the next crawler
   scheduled run, `/data` database persistence, published snapshot output,
   `catalog_updated_at`, and (if #352 merged) `plugins` summaries.
7. Preserve the previous working deployment and record service configuration.
   If the new build fails, revert the Railway root/build/start/watch
   configuration as one coordinated change. If the shared schema or app
   itself regresses, revert the code change as well; do not roll back crawler
   database/storage migrations blindly.

## No-go checklist

- [ ] PR #369 integrated, #352 changes accounted for
- [ ] Contract matches #367 + #370 + #352; fixture tests verify the *published* shape
- [ ] All required CI green at the final SHA
- [ ] Both Railway services have a reviewed target config
- [ ] Target root contains the package lock, UI, crawler, and shared package
- [ ] Deployment window and rollback owner agreed
- [ ] Crawler cron, persistent volume, and secrets preserved
