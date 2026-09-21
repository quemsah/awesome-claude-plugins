/** biome-ignore-all lint/style/useNamingConvention: Test assertion mirrors catalog field names. */

import { describe, expect, it } from 'vitest'
import { GET as feedJson } from '../app/feed.json/route.ts'
import { GET as llmsTxt } from '../app/llms.txt/route.ts'
import { getCanonicalCatalogRepos, getCatalogRepos, searchCatalogRepos } from './catalog.ts'

describe('catalog totals the machine surfaces publish', () => {
  it('reports fewer repositories than there are records, so duplicate spellings are not counted twice', () => {
    expect(getCatalogRepos().length).toBeGreaterThan(getCanonicalCatalogRepos().length)
  })

  it('matches the repository and plugin totals the home page shows', async () => {
    const home = searchCatalogRepos('', 'stars-desc')
    const llms = await (await llmsTxt()).text()
    const feed = (await (await feedJson()).json()) as { items: { content_text: string }[] }

    expect(llms).toContain(`- Repositories indexed: ${home.total}`)
    expect(llms).toContain(`- Plugin entries reported by catalog data: ${home.pluginsCount}`)
    expect(feed.items[0].content_text).toContain(`The catalog contains ${home.total} repositories`)
    expect(feed.items[0].content_text).toContain(`and ${home.pluginsCount} reported plugin entries`)
  })
})
