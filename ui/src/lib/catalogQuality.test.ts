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
  it('marks canonical records with a validated plugin count as indexable', () => {
    expect(getCatalogQuality(baseRepo, true)).toEqual({
      descriptionQuality: 'strong',
      publicationState: 'indexable',
      qualityReason: 'Canonical repository has a validated plugin count.',
    })
  })

  it('keeps missing descriptions as quality metadata without blocking indexing', () => {
    expect(getCatalogQuality({ ...baseRepo, description: null }, true)).toEqual({
      descriptionQuality: 'missing',
      publicationState: 'indexable',
      qualityReason: 'Canonical repository has a validated plugin count.',
    })
  })

  it('holds records without a validated plugin count for review', () => {
    expect(getCatalogQuality({ ...baseRepo, plugins_count: null }, true)).toEqual({
      descriptionQuality: 'strong',
      publicationState: 'needs-review',
      qualityReason: 'Validated marketplace plugin count is unavailable.',
    })
  })

  it('marks non-canonical duplicate records as redirects', () => {
    expect(getCatalogQuality(baseRepo, false).publicationState).toBe('redirect')
  })
})
