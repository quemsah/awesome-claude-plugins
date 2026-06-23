# Dependency Policy

The app lives in `ui/` and uses npm with a checked-in lockfile.

## Dependency Categories

- `dependencies` are packages imported by production application code at runtime or bundled into the app.
- `devDependencies` are build tools, lint tools, test tools, type packages, and packages used only through `import type`.
- Type-only GitHub API schemas belong in `devDependencies`; `@octokit/openapi-types` is not a runtime package.
- Unused direct dependencies should be removed rather than kept for possible future components.

## Pinning Policy

- Framework packages (`next`, `react`, `react-dom`) stay pinned exactly because they define runtime, compiler, and hydration behavior.
- High-impact UI primitives can be pinned when compatibility is sensitive; otherwise caret ranges are acceptable for low-risk leaf packages.
- Tooling packages may use caret ranges, but Renovate groups them separately from runtime changes.

## Renovate Policy

- Framework updates are isolated in their own group and delayed by seven days.
- Runtime dependency minor and patch updates are grouped separately from framework updates.
- Type and tooling updates are grouped separately from runtime packages.
- Major updates stay in a separate group for explicit review.
- Lockfile maintenance is disabled until main has full build, typecheck, test, and data-validation gates. Enable it only after those checks are required for pull requests.
