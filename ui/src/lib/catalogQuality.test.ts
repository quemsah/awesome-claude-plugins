/** biome-ignore-all lint/style/useNamingConvention: Test fixture mirrors catalog field names. */

import { describe, expect, it } from 'vitest'
import { getCatalogQuality, getDescriptionQuality } from './catalogQuality.ts'

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

const strongFallbackDescription = 'A plugin manifest description that is at least forty characters long for quality.'

describe('getCatalogQuality', () => {
  it('marks canonical records with a validated plugin count as indexable', () => {
    expect(getCatalogQuality(baseRepo, true)).toEqual({
      descriptionQuality: 'strong',
      publicationState: 'indexable',
      qualityReason: 'Canonical repository has a validated plugin count.',
    })
  })

  it('holds truly empty records with missing description for review', () => {
    expect(getCatalogQuality({ ...baseRepo, description: null }, true)).toEqual({
      descriptionQuality: 'missing',
      publicationState: 'needs-review',
      qualityReason: 'Repository description is missing.',
    })
  })

  it('permits indexing when fallback manifest description is strong (>= 40 characters)', () => {
    expect(getCatalogQuality({ ...baseRepo, description: null }, true, strongFallbackDescription)).toEqual({
      descriptionQuality: 'strong',
      publicationState: 'indexable',
      qualityReason: 'Canonical repository has a validated plugin count.',
    })
  })

  it('holds records for review when fallback manifest description is weak (< 40 characters)', () => {
    expect(getCatalogQuality({ ...baseRepo, description: null }, true, 'Short manifest plugin')).toEqual({
      descriptionQuality: 'weak',
      publicationState: 'needs-review',
      qualityReason: 'Repository description is missing.',
    })
  })

  it('prioritizes existing repository description over fallback', () => {
    expect(getCatalogQuality(baseRepo, true, 'Short')).toEqual({
      descriptionQuality: 'strong',
      publicationState: 'indexable',
      qualityReason: 'Canonical repository has a validated plugin count.',
    })
  })

  it('holds records without a validated plugin count for review even with strong fallback description', () => {
    expect(getCatalogQuality({ ...baseRepo, description: null, plugins_count: null }, true, strongFallbackDescription)).toEqual({
      descriptionQuality: 'strong',
      publicationState: 'needs-review',
      qualityReason: 'Validated marketplace plugin count is unavailable.',
    })
  })

  it('marks non-canonical duplicate records as redirects', () => {
    expect(getCatalogQuality(baseRepo, false).publicationState).toBe('redirect')
  })
})

describe('getDescriptionQuality', () => {
  it('identifies strong and weak repository descriptions', () => {
    expect(getDescriptionQuality(baseRepo)).toBe('strong')
    expect(getDescriptionQuality({ ...baseRepo, description: 'Short description' })).toBe('weak')
  })

  it('evaluates fallback description when repository description is empty or null', () => {
    expect(getDescriptionQuality({ ...baseRepo, description: null }, strongFallbackDescription)).toBe('strong')
    expect(getDescriptionQuality({ ...baseRepo, description: '   ' }, 'Short')).toBe('weak')
  })

  it('returns missing when neither repository nor fallback description is provided', () => {
    expect(getDescriptionQuality({ ...baseRepo, description: null })).toBe('missing')
    expect(getDescriptionQuality({ ...baseRepo, description: null }, '   ')).toBe('missing')
  })
})
