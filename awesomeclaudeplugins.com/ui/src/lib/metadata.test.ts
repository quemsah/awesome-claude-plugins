import { describe, expect, it } from 'vitest'
import { BASE_URL } from './constants.ts'
import { withSiteAlternates } from './metadata.ts'

describe('withSiteAlternates', () => {
  it('keeps the catalog feed without claiming a Markdown rendition for unrelated pages', () => {
    expect(withSiteAlternates({ canonical: `${BASE_URL}/privacy` })).toEqual({
      canonical: `${BASE_URL}/privacy`,
      types: {
        'application/feed+json': `${BASE_URL}/feed.json`,
      },
    })
  })

  it('preserves a page-specific Markdown rendition alongside the catalog feed', () => {
    expect(
      withSiteAlternates({
        canonical: `${BASE_URL}/about`,
        types: { 'text/markdown': `${BASE_URL}/about.md` },
      })
    ).toEqual({
      canonical: `${BASE_URL}/about`,
      types: {
        'application/feed+json': `${BASE_URL}/feed.json`,
        'text/markdown': `${BASE_URL}/about.md`,
      },
    })
  })
})
