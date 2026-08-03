/** biome-ignore-all lint/style/useNamingConvention: Test fixture mirrors catalog field names. */

import { describe, expect, it } from 'vitest'
import { getCatalogQuality } from './catalogQuality.ts'

const baseRepo = {
  html_url: 'https://github.com/example/repository',
  stargazers_count: 10,
  forks_count: 1,
  subscribers_count: 1,
  description: 'A repository description that is long enough to be strong.',
  owner: 'example',
  owner_url: 'https://github.com/example',
  repo_name: 'repository',
  plugins_count: 2,
  id: 1,
} as const

describe('getCatalogQuality', () => {
  it('marks complete canonical records as indexable', () => {
    expect(getCatalogQuality(baseRepo, true)).toEqual({
      descriptionQuality: 'strong',
      publicationState: 'indexable',
      qualityReason: 'Canonical repository has a description and validated plugin count.',
    })
  })

  it('holds records with missing publication signals for review', () => {
    expect(getCatalogQuality({ ...baseRepo, description: null }, true).publicationState).toBe('needs-review')
    expect(getCatalogQuality({ ...baseRepo, plugins_count: null }, true).publicationState).toBe('needs-review')
  })

  it('marks non-canonical duplicate records as redirects', () => {
    expect(getCatalogQuality(baseRepo, false).publicationState).toBe('redirect')
  })
})
