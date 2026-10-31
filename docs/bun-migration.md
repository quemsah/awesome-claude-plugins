# Bun migration (branch `bun-6-x-m`)

The Node.js version remains pinned to 24.22.2: Next.js and the crawler still run on Node.js. Bun is the **package manager / script runner**, not a replacement for the application runtime.

## Verify before merging

From `awesomeclaudeplugins.com`:

```sh
bun install
bun install --frozen-lockfile
bun run --cwd crawler smoke:sqlite
bun run --cwd crawler typecheck
bun run --cwd crawler lint
bun run --cwd crawler test
bun run --cwd crawler typecheck:integration
bun run --cwd crawler test:integration
bun run --cwd ui typecheck
bun run --cwd ui lint
bun run --cwd ui test:unit
bun run --cwd ui build
bunx --cwd ui playwright install --with-deps chromium
bun run --cwd ui test:e2e
bun audit --prod --audit-level=high
bun audit --audit-level=high
```

Commit `bun.lock` and delete `package-lock.json` once generated. The temporary branch-only `.github/workflows/bun-lock-migration.yml` must be removed before merging.

## Railway cutover (coordinate with merge)

Both services currently use `/awesomeclaudeplugins.com` as root directory and depend on npm CLI commands. **Do not merge without updating Railway**: deleting the npm lockfile while leaving `npm ci` in Railway will break production.

The Railpack build environment must make Bun 1.3.1 available (pin it explicitly; keep Node 24.22.2 installed for runtime). Verify Bun is actually on PATH in the deployed build and runtime images.

UI service:
- Build: `bun install --frozen-lockfile && bun run build:ui`
- Start: `bun run start:ui`
- Watch: replace `package-lock.json` with `bun.lock` and remove obsolete `.npmrc` entry.

Crawler service:
- Build: `bun install --frozen-lockfile && bun run build:crawler`
- Start: `bun run start:crawler`
- Watch: replace `package-lock.json` with `bun.lock` and remove obsolete `.npmrc` entry.

The crawler includes the `better-sqlite3` native module, so the build's `smoke:sqlite` step is a hard gate. Keep the crawler's nightly cron, persisted /data volume, and existing environment variables unchanged.

Verify in a non-production environment first; cut over only after CI and a successful deployment. Roll back to the previous deploy and npm configuration if either service fails.

## Audit

Dependency audit stays weekly (Monday at 07:00 UTC). The whole graph and production-only graph are each audited with Bun. Maintain the fail-on-high and fail-on-critical checks.
