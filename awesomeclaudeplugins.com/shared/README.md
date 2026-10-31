# Shared code

All code shared between `../ui` and `../crawler` belongs here. Packages should have one canonical owner for the published catalog contract, GitHub URL/identity helpers and marketplace parsing. Keep runtime-only logic inside the respective app. PR #378 will add `shared/catalog-contract` as the first actual package; don't duplicate its implementation here.

The initial directory-layout PR intentionally did **not** change dependency resolution. Both apps now resolve this package through the Bun workspace declared in `../package.json`.
