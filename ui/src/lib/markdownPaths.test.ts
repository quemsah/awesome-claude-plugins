import { describe, expect, it } from 'vitest'
import { getCatalogRepos } from './catalog.ts'
import { isRepoPageEndingInMd, REPO_PAGES_ENDING_IN_MD } from './markdownPaths.ts'

const MARKDOWN_EXTENSION = /\.md$/i

function catalogPaths(): string[] {
  return getCatalogRepos().map((repo) => `${repo.owner}/${repo.repo_name}`)
}

function selectRepoPagesEndingInMd(repoPaths: readonly string[]): string[] {
  const listed = new Set<string>()

  return repoPaths.filter((repoPath) => {
    const path = repoPath.toLowerCase()
    if (!MARKDOWN_EXTENSION.test(repoPath) || listed.has(path)) {
      return false
    }
    listed.add(path)
    return true
  })
}

function findMarkdownPathCollisions(repoPaths: readonly string[]): string[] {
  const catalogued = new Set(repoPaths.map((repoPath) => repoPath.toLowerCase()))
  const collisions = new Set<string>()

  for (const repoPath of repoPaths) {
    const path = repoPath.toLowerCase()
    if (MARKDOWN_EXTENSION.test(repoPath) && catalogued.has(path.slice(0, -3))) {
      collisions.add(path)
    }
  }

  return [...collisions].sort()
}

function byPath(repoPaths: readonly string[]): string[] {
  return [...repoPaths].sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }))
}

describe('REPO_PAGES_ENDING_IN_MD', () => {
  it('is exactly what the catalog says it should be', () => {
    // A dataset refresh that adds or removes a `.md`-named repository lands here. Regenerate the
    // list from the expected side of that diff; until then the proxy 404s that repository's page.
    expect(byPath(REPO_PAGES_ENDING_IN_MD)).toEqual(byPath(selectRepoPagesEndingInMd(catalogPaths())))
  })

  it('rejects catalog entries whose html path collides with another repository markdown path', () => {
    expect(findMarkdownPathCollisions(catalogPaths())).toEqual([])
  })

  it('is not empty, so the comparison above cannot pass by accident', () => {
    expect(REPO_PAGES_ENDING_IN_MD.length).toBeGreaterThan(0)
  })
})

describe('selectRepoPagesEndingInMd', () => {
  it('recognises the extension whatever case it is spelled in', () => {
    expect(selectRepoPagesEndingInMd(['a/b.MD'])).toEqual(['a/b.MD'])
  })

  it('lists a path once even when the catalog holds case-only duplicates', () => {
    expect(selectRepoPagesEndingInMd(['a/b.md', 'A/B.md'])).toEqual(['a/b.md'])
  })
})

describe('findMarkdownPathCollisions', () => {
  it('detects a suffix collision without regard to case', () => {
    expect(findMarkdownPathCollisions(['A/B', 'a/b.MD', 'c/d.md'])).toEqual(['a/b.md'])
  })
})

describe('isRepoPageEndingInMd', () => {
  it('accepts a listed repository path in any case', () => {
    expect(isRepoPageEndingInMd('sstklen/yes.md')).toBe(true)
    expect(isRepoPageEndingInMd('Sstklen/Yes.md')).toBe(true)
  })

  it('rejects a path that is not a repository named after the suffix', () => {
    expect(isRepoPageEndingInMd('ykdojo/claude-code-tips')).toBe(false)
    expect(isRepoPageEndingInMd('sstklen/yes')).toBe(false)
    expect(isRepoPageEndingInMd('no-such-owner/no-such-repo.md')).toBe(false)
  })
})
