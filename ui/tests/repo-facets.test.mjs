/** biome-ignore-all lint/style/useNamingConvention: catalog fixtures use snake_case fields */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { filterReposByFacets, getCategoryOptions, getKeywordOptions, getRepoCategories, getRepoKeywords } from '../src/lib/repoFacets.mjs'

const repos = [
  {
    repo_name: 'claude-agent-workflows',
    owner: 'example',
    description: 'Claude agent workflow automation with MCP integration',
  },
  {
    repo_name: 'security-review-skill',
    owner: 'example',
    description: 'Security review skill for code compliance',
  },
]

describe('repository facets', () => {
  it('generates categories from repository text', () => {
    assert.equal(getRepoCategories(repos[0]).includes('agent-workflows'), true)
    assert.equal(getRepoCategories(repos[0]).includes('mcp-integrations'), true)
  })

  it('generates keyword facets from repository text', () => {
    assert.deepEqual(
      getRepoKeywords(repos[1]).filter((keyword) => ['security', 'review', 'skill'].includes(keyword)),
      ['skill', 'security', 'review']
    )
  })

  it('filters by category and keyword together', () => {
    assert.deepEqual(filterReposByFacets(repos, { category: 'security-operations', keyword: 'review' }), [repos[1]])
  })

  it('counts facet options for the current result set', () => {
    assert.equal(getCategoryOptions(repos).find((option) => option.value === 'mcp-integrations')?.count, 1)
    assert.equal(getKeywordOptions(repos).find((option) => option.value === 'claude')?.count, 1)
  })
})
