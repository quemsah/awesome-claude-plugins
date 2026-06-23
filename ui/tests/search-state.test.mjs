import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildSearchUrl, defaultSortOption, parseSortOption } from '../src/lib/searchState.mjs'

describe('search URL state', () => {
  it('parses invalid sort options as the default', () => {
    assert.equal(parseSortOption('bad-sort'), defaultSortOption)
  })

  it('stores search and non-default sort in the URL', () => {
    assert.equal(buildSearchUrl('/', '', { searchTerm: 'headroom', sortOption: 'plugins-desc' }), '/?q=headroom&sort=plugins-desc')
  })

  it('removes empty search and default sort from the URL', () => {
    assert.equal(buildSearchUrl('/', 'q=headroom&sort=forks-desc', { searchTerm: '', sortOption: defaultSortOption }), '/')
  })

  it('preserves unknown future filter params', () => {
    assert.equal(
      buildSearchUrl('/', 'category=security', { searchTerm: 'skills', sortOption: defaultSortOption }),
      '/?category=security&q=skills'
    )
  })
})
