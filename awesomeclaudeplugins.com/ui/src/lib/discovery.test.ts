import { describe, expect, it } from 'vitest'
import { GET as skillMarkdown } from '../app/SKILL.md/route.ts'
import { BASE_URL } from './constants.ts'
import { apiCatalogLinks } from './discovery.ts'
import { buildLlmsText, type CatalogSummary } from './llmsText.ts'

const summary: CatalogSummary = { repoCount: 10, pluginRepositoryCount: 5, pluginCount: 7, updatedAt: '2026-01-01' }

describe('catalog discovery inventory', () => {
  it('advertises absolute, unique resources only', () => {
    const hrefs = apiCatalogLinks.map((link) => link.href)

    expect(hrefs.every((href) => href.startsWith(`${BASE_URL}/`))).toBe(true)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('lists every resource in the agent skill document', async () => {
    const skill = await (await skillMarkdown()).text()

    for (const { href, type } of apiCatalogLinks) {
      expect(skill).toContain(href)
      expect(skill).toContain(type)
    }
    expect(skill).toContain(`${BASE_URL}/.well-known/api-catalog`)
  })

  it('points the model summary at every member API and the API catalog', () => {
    const llms = buildLlmsText(summary)

    for (const { href, rel } of apiCatalogLinks) {
      if (rel === 'item') {
        expect(llms).toContain(href)
      }
    }
    expect(llms).toContain(`${BASE_URL}/.well-known/api-catalog`)
  })

  it('tells agents that a repository named after the suffix answers to the doubled one', async () => {
    const skill = await (await skillMarkdown()).text()

    expect(skill).toContain('/sstklen/yes.md.md')
    expect(buildLlmsText(summary)).toContain('{owner}/{repo}.md.md')
  })
})
