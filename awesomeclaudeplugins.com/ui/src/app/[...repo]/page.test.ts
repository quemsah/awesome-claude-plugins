/** biome-ignore-all lint/style/useNamingConvention: Catalog fixtures use the public snake_case field names. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateMetadata } from './page.tsx'

// Keep metadata tests independent of churn in the checked-in daily catalog snapshot.
vi.mock('../../lib/catalog.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/catalog.ts')>()
  return {
    ...original,
    findCatalogRepo: (path: string) =>
      path === 'chrisliu298/nanoresearch'
        ? {
            id: 123456789,
            owner: 'chrisliu298',
            repo_name: 'nanoresearch',
            html_url: 'https://github.com/chrisliu298/nanoresearch',
            owner_url: 'https://github.com/chrisliu298',
            description: null,
            stargazers_count: 2,
            forks_count: 0,
            subscribers_count: 0,
            plugins_count: 1,
            manifest_kind: 'standalone-plugin',
            plugins: [
              {
                name: 'nanoresearch',
                description: 'A high-performance research automation plugin for Claude Code workflows.',
              },
            ],
          }
        : path === 'sparse/repo'
          ? {
              id: 123456790,
              owner: 'sparse',
              repo_name: 'repo',
              html_url: 'https://github.com/sparse/repo',
              owner_url: 'https://github.com/sparse',
              description: null,
              stargazers_count: 0,
              forks_count: 0,
              subscribers_count: 0,
              plugins_count: null,
              plugins: [{ name: 'Only a name; no description.' }],
            }
          : original.findCatalogRepo(path),
    getCatalogQualityForRepo: (repo: Parameters<typeof original.getCatalogQualityForRepo>[0]) =>
      repo.owner === 'chrisliu298'
        ? { descriptionQuality: 'strong' as const, publicationState: 'indexable' as const, qualityReason: 'Validated plugins.' }
        : repo.owner === 'sparse'
          ? {
              descriptionQuality: 'missing' as const,
              publicationState: 'needs-review' as const,
              qualityReason: 'Validated plugin count is unavailable.',
            }
          : original.getCatalogQualityForRepo(repo),
  }
})
const detailImagePattern = /\/og\/ykdojo\/claude-code-tips$/

describe('generateMetadata', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the catalog verified plugin summary for standalone metadata without fetching GitHub', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const metadata = await generateMetadata({ params: Promise.resolve({ repo: ['chrisliu298', 'nanoresearch'] }) })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(metadata.title).toBe('chrisliu298/nanoresearch — Standalone plugin')
    expect(metadata.description).toBe('A high-performance research automation plugin for Claude Code workflows.')
    expect(metadata.openGraph).toMatchObject({
      title: metadata.title,
      description: metadata.description,
    })
    expect(metadata.twitter).toMatchObject({
      title: metadata.title,
      description: metadata.description,
    })
    expect(metadata.robots).toEqual({ index: true, follow: true })
  })

  it('uses the repository description and canonical case for a legacy marketplace', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ repo: ['YkDoJo', 'CLAUDE-CODE-TIPS'] }) })

    expect(metadata.title).toBe('ykdojo/claude-code-tips — Marketplace')
    expect(metadata.description).toBe('Tips and practical advice for using Claude Code.')
    expect(metadata.alternates).toMatchObject({ canonical: 'https://awesomeclaudeplugins.com/ykdojo/claude-code-tips' })
    expect(metadata.openGraph).toMatchObject({
      url: 'https://awesomeclaudeplugins.com/ykdojo/claude-code-tips',
      title: metadata.title,
      description: metadata.description,
      images: [{ url: expect.stringMatching(detailImagePattern) }],
    })
    expect(metadata.twitter).toMatchObject({ title: metadata.title, description: metadata.description })
    expect(metadata.robots).toEqual({ index: true, follow: true })
  })

  it('uses a generic description and keeps review-needed records noindex when snapshot metadata is sparse', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const metadata = await generateMetadata({ params: Promise.resolve({ repo: ['sparse', 'repo'] }) })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(metadata.title).toBe('sparse/repo')
    expect(metadata.description).toBe('Explore sparse/repo in the Awesome Claude Plugins directory.')
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })
})
