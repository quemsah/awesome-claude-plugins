# Migrating this workspace from npm to Bun

This repository uses **Bun 1.4.4 to install dependencies and launch package scripts**. The UI (Next.js), crawler and tests still use **Node.js 24.22.2** as their JavaScript runtime when their executables specify Node via shebang. Do not switch the application runtime as part of this migration.

## Local verification

From `awesomeclaudeplugins.com/`:

```sh
bun --version  # 1.4.4
bun install --frozen-lockfile
bun run --filter catalog-crawler smoke:sqlite
bun run --filter catalog-crawler typecheck
bun run --filter catalog-crawler lint
bun run --filter catalog-crawler test
bun run --filter catalog-crawler typecheck:integration
bun run --filter catalog-crawler test:integration
bun run --filter awesome-claude-plugins typecheck
bun run --filter awesome-claude-plugins lint
bun run --filter awesome-claude-plugins test:unit
bun run build:ui
bunx playwright install --with-deps chromium
bun run --filter awesome-claude-plugins test:e2e
bun audit --prod --audit-level=high
bun audit --audit-level=high
```

The committed `bun.lock` is generated from the prior npm lockfile with `bun install --lockfile-only`, not recreated manually. `better-sqlite3` is listed in `trustedDependencies` because Bun does not execute arbitrary third-party install scripts.

## Railway: coordinated cutover required

The two existing Railway production services currently use **explicit npm build and start commands**, and their watch patterns reference `package-lock.json`. These settings override the repository's scripts; **do not merge until the service settings are migrated in coordination with the deployment**.

Both services retain root directory `/awesomeclaudeplugins.com`, builder `RAILPACK`, and Node.js 24.22.2:

| Service | Build command | Start command |
| --- | --- | --- |
| Web UI | `bun install --frozen-lockfile && bun run build:ui` | `bun run start:ui` |
| crawler | `bun install --frozen-lockfile && bun run build:crawler` | `bun run start:crawler` |

For **both** services replace watch-pattern `/awesomeclaudeplugins.com/package-lock.json` with `/awesomeclaudeplugins.com/bun.lock` and preserve the other existing patterns. Retain the crawler's volume mount, schedule and restart policy. Never run a production crawler backfill during the package-manager migration.

Railpack detects Bun from `packageManager` and `bun.lock`. The existing `.nvmrc` and `engines.node` preserve the Node.js version needed by the tools. Before changing production, review the PR CI (including native SQLite smoke and browser E2E). After cutover, verify the live website, web build, crawler native module and first scheduled run; roll back both the commit and the Railway commands together if needed.
