/** biome-ignore-all lint/style/useNamingConvention: Test assertion mirrors catalog field names. */

import { describe, expect, it } from 'vitest'
import { GET as feedJson } from '../app/feed.json/route.ts'
import { GET as llmsTxt } from '../app/llms.txt/route.ts'
import { getCanonicalCatalogRepos, searchCatalogRepos } from './catalog.ts'
import { getCatalogSummary } from './llmsText.ts'

function required<T>(values: readonly T[], index: number): T {
  const value = values[index]
  if (value === undefined) throw new Error(`Missing fixture at index ${index}`)
  return value
}

describe('catalog totals the machine surfaces publish', () => {
  it('deduplicates repository paths case-insensitively even when given raw-style records', () => {
    const repo = getCanonicalCatalogRepos()[0]
    if (!(repo?.owner && repo.repo_name)) {
      throw new Error('Expected the canonical catalog to contain a repository')
    }

    const duplicate = {
      ...repo,
      owner: repo.owner.toUpperCase(),
      repo_name: repo.repo_name.toUpperCase(),
    }

    expect(getCatalogSummary([repo, duplicate], []).repoCount).toBe(1)
  })

  it('matches the repository and plugin totals the home page shows', async () => {
    const home = searchCatalogRepos('', 'stars-desc')
    const llms = await (await llmsTxt()).text()
    const feed = (await (await feedJson()).json()) as { items: { content_text: string }[] }

    expect(llms).toContain(`- Repositories indexed: ${home.total}`)
    expect(llms).toContain(`- Plugin entries reported by catalog data: ${home.pluginsCount}`)
    expect(required(feed.items, 0).content_text).toContain(`The catalog contains ${home.total} repositories`)
    expect(required(feed.items, 0).content_text).toContain(`and ${home.pluginsCount} reported plugin entries`)
  })
})
