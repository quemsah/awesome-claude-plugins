# Shared code

All code shared between `../ui` and `../crawler` belongs here. Packages should have one canonical owner for the published catalog contract, GitHub URL/identity helpers and marketplace parsing. Keep runtime-only logic inside the respective app. The `awesomeclaudeplugins.com/` monorepo uses Bun workspaces; don't duplicate the implementation in `shared/catalog-contract`.

Install dependencies from the monorepo root with `bun install --frozen-lockfile`.
