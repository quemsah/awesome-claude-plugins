# Development

Use Bun 1.4.4 for dependency installation and workspace scripts. The UI and crawler still run on Node.js 24.22.2.

From this directory:

```sh
bun install --frozen-lockfile
bun run --filter awesome-claude-plugins dev
bun run build:ui
bun run build:crawler
```

Run package checks from the relevant workspace:

```sh
cd ui
bun run typecheck
bun run lint
bun run test:unit
bun run test:e2e
```

The crawler workspace has `typecheck`, `lint`, `test`, `typecheck:integration`, and `test:integration` scripts. Commit `bun.lock` when dependencies change.
