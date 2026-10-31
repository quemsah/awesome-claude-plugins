# Shared code

All code shared between `../ui` and `../crawler` belongs here. Packages should have one canonical owner for the published catalog contract, GitHub URL/identity helpers and marketplace parsing. Keep runtime-only logic inside the respective app. `shared/catalog-contract` owns the shared contract; don't duplicate its implementation here.

The root Bun workspace resolves `ui`, `crawler`, and `shared/*` together. Install dependencies from `awesomeclaudeplugins.com` with `bun install --frozen-lockfile`.
