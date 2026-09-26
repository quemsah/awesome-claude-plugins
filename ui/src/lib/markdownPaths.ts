import markdownPathsData from '../data/markdown-paths.json' with { type: 'json' }

/**
 * Catalogued repositories whose name ends with the markdown extension, so their HTML page
 * (`/sstklen/yes.md`) is spelled exactly the way the proxy normally spells a repository's
 * markdown representation (`/{owner}/{repo}.md`).
 *
 * This namespace is only unambiguous while the catalog does not also contain the same path without
 * the suffix (for example both `a/b` and `a/b.md`). `markdownPaths.test.ts` enforces that
 * invariant and fails CI if such a collision appears; the proxy deliberately does not invent an
 * alternate HTML URL for an unsupported collision.
 *
 * Loaded from a generated sidecar rather than the full catalog because the proxy is its own bundle.
 * The crawler snapshot publisher regenerates that sidecar atomically with `repos.json`, so this
 * exception set stays in sync without paying the cost of importing and validating the full catalog
 * in every server process. `markdownPaths.test.ts` still verifies the generated data against the catalog.
 */
export const REPO_PAGES_ENDING_IN_MD: readonly string[] = markdownPathsData

const repoPagePaths = new Set(REPO_PAGES_ENDING_IN_MD.map((repoPath) => repoPath.toLowerCase()))

/** Whether a path ending in `.md` is a repository page rather than a markdown representation. */
export function isRepoPageEndingInMd(repoPath: string): boolean {
  return repoPagePaths.has(repoPath.toLowerCase())
}
