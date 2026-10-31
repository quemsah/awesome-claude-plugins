# Shared code

Packages here are part of the Bun workspace rooted at `awesomeclaudeplugins.com/`. Both `ui` and `crawler` consume `shared/catalog-contract`, which is the canonical catalog contract.

Put cross-package contracts, fixtures and parsing helpers here. Keep runtime-specific logic in its owning application. Install workspace dependencies once from the workspace root with `bun install --frozen-lockfile`.
