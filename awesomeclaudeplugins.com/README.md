# awesomeclaudeplugins.com

This directory contains the deployable website and its supporting crawler.

- `ui/`: Next.js website and checked-in catalog snapshots.
- `crawler/`: GitHub crawler and catalog publisher.
- `shared/`: reusable contracts, schemas and helpers used by both applications. The first shared implementation lands in PR #378; this foundation PR changes **paths only**, not runtime APIs or npm dependency topology.

## Current commands (before PR #378)

Use each app's existing lockfile and install independently from the repository root:

```sh
npm --prefix awesomeclaudeplugins.com/ui ci
npm --prefix awesomeclaudeplugins.com/ui run build
npm --prefix awesomeclaudeplugins.com/crawler ci
npm --prefix awesomeclaudeplugins.com/crawler run test
```

Crawler integration tests use the sibling `ui/` schemas. GitHub publishing targets `awesomeclaudeplugins.com/ui/src/data/*.json`; the generated catalog `README.md` remains at repository root.

Read [the deployment cutover checklist](docs/railway-migration.md) **before merging** this PR. Moving the directory alone does not migrate existing Railway root directories.
