# Development Setup

The web app lives in `ui/`. Use Node 24 and npm 10.8.2, matching `ui/package.json`, `.nvmrc`, and `.node-version`.

## Node Version

With `nvm`:

```sh
nvm use
```

With `mise` or `asdf`, the `.node-version` file selects Node 24.

## Install

```sh
cd ui
npm ci
```

## Common Commands

Run these from `ui/`:

```sh
npm run dev
npm run lint
npm run typecheck
npm test
npm run validate:data
npm run build
```

Use the full local verification gate before opening a pull request:

```sh
npm run verify
```

## Command Reference

- `npm run dev`: start the local Next.js development server.
- `npm run lint`: run Biome without writing changes.
- `npm run style`: run Biome with project formatting and safe writes.
- `npm run typecheck`: run TypeScript without emitting files.
- `npm test`: run Node test files under `ui/tests/`.
- `npm run validate:data`: verify checked-in catalog JSON shape and stats count.
- `npm run build`: create a production Next.js build.
- `npm run verify`: run data validation, lint, typecheck, tests, and build in order.
