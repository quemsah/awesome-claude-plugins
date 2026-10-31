# Development

Use Bun **1.4.4** (pinned in `package.json`) to manage all workspaces. Keep Node.js at the version in `.node-version` for Next.js, Vitest, Playwright, and the crawler native SQLite addon; `bun run` keeps their Node.js runtime.

From this directory:

```sh
bun install --frozen-lockfile
bun run --cwd ui dev
bun run build:ui
bun run build:crawler
bun run --cwd ui typecheck
bun run --cwd ui lint
bun run --cwd ui test:unit
bun run --cwd crawler typecheck
bun run --cwd crawler lint
bun run --cwd crawler test
bun run --cwd crawler typecheck:integration
bun run --cwd crawler test:integration
cd ui && bunx --no-install playwright install chromium && cd ..
bun run --cwd ui test:e2e
node --test ui/scripts/indexnow-*.test.mjs
bun audit --prod --audit-level=high
bun audit --audit-level=high
```

For Playwright browser installation, run `bunx --no-install playwright install chromium` from `ui/` (on Linux CI, add `--with-deps`). Local E2E tests build and start the app and the mock GitHub server automatically. CI builds with the mock GitHub origins before using `PLAYWRIGHT_PREBUILT=1`.

Commit `bun.lock` after dependency changes with `bun install` or `bun add`; CI installs it with `--frozen-lockfile`. The hoisted install layout is explicit in `bunfig.toml`. `trustedDependencies` allows the `better-sqlite3` install script so its native Node.js bindings are available; `bun run --cwd crawler smoke:sqlite` verifies them. Do not force the Bun runtime with `--bun` for this addon.

CI and the Husky pre-commit hook use Bun. Deployment builders should run `bun install --frozen-lockfile` from this directory and use `bun run build:ui` / `bun run start:ui` or `bun run build:crawler` / `bun run start:crawler` as appropriate. The Node.js version files remain the runtime source of truth.

The npm references inside catalog data, external plugin examples, and Renovate's npm registry datasource describe upstream packages and remain unchanged.
