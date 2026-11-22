/** biome-ignore-all lint/style/useNamingConvention: Catalog fixtures use the published snake_case fields. */

import { describe, expect, it } from 'vitest'
import type { CatalogRepo } from './catalog.ts'
import { getRepoPageMetadata } from './repoPageMetadata.ts'

const baseRepo = {
  id: 1,
  owner: 'example-owner',
  repo_name: 'example-repo',
  description: null,
  stargazers_count: 0,
  forks_count: 0,
  subscribers_count: 0,
  plugins_count: 1,
} satisfies CatalogRepo

describe('getRepoPageMetadata', () => {
  it('prefers the catalog GitHub description and labels a marketplace', () => {
    expect(
      getRepoPageMetadata({
        ...baseRepo,
        description: 'A useful GitHub repository description.',
        manifest_kind: 'marketplace',
        plugins: [{ name: 'other-plugin', description: 'A different verified plugin summary with enough detail.' }],
      })
    ).toEqual({
      title: 'example-owner/example-repo — Marketplace',
      description: 'A useful GitHub repository description.',
    })
  })

  it('uses a single meaningful verified plugin summary when the repository description is missing', () => {
    expect(
      getRepoPageMetadata({
        ...baseRepo,
        manifest_kind: 'standalone-plugin',
        plugins: [
          {
            name: 'example-plugin',
            description: 'A verified code review assistant that summarizes changes for Claude Code maintainers.',
          },
        ],
      })
    ).toEqual({
      title: 'example-owner/example-repo — Standalone plugin',
      description: 'A verified code review assistant that summarizes changes for Claude Code maintainers.',
    })
  })

  it('uses generic copy when an omitted legacy marketplace kind has no repository or usable plugin summary', () => {
    expect(
      getRepoPageMetadata({
        ...baseRepo,
        plugins: [
          { name: 'first-plugin', description: 'A first plugin summary with enough text to sound plausible.' },
          { name: 'second-plugin', description: 'A second plugin summary with enough text to sound plausible.' },
        ],
      })
    ).toEqual({
      title: 'example-owner/example-repo — Marketplace',
      description: 'Explore example-owner/example-repo in the Awesome Claude Plugins directory.',
    })
  })

  it('does not treat short plugin labels as meaningful fallback descriptions', () => {
    expect(
      getRepoPageMetadata({
        ...baseRepo,
        manifest_kind: 'standalone-plugin',
        plugins: [{ name: 'example-plugin', description: 'A short description.' }],
      }).description
    ).toBe('Explore example-owner/example-repo in the Awesome Claude Plugins directory.')
  })
})
