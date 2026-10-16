import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateMetadata } from './page.tsx'

const detailImagePattern = /\/og\/ykdojo\/claude-code-tips$/

describe('generateMetadata', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('includes the detail page Open Graph image', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ repo: ['ykdojo', 'claude-code-tips'] }) })

    expect(metadata.openGraph).toMatchObject({
      images: [{ url: expect.stringMatching(detailImagePattern) }],
    })
  })

  it('uses manifest description fallback and permits indexing when repo description is null', async () => {
    const manifestDescription = 'A high-performance research automation plugin for Claude Code workflows.'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: 'nanoresearch',
        description: manifestDescription,
        plugins: [{ name: 'nanoresearch', source: './' }],
      }),
    } as Response)

    const metadata = await generateMetadata({ params: Promise.resolve({ repo: ['chrisliu298', 'nanoresearch'] }) })

    expect(fetchSpy).toHaveBeenCalled()
    expect(metadata.description).toBe(manifestDescription)
    expect(metadata.robots).toEqual({ index: true, follow: true })
  })

  it('keeps truly empty repos non-indexed when manifest description is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response)

    const metadata = await generateMetadata({ params: Promise.resolve({ repo: ['chrisliu298', 'nanoresearch'] }) })

    expect(metadata.description).toBe('Explore chrisliu298/nanoresearch in the Awesome Claude Plugins directory.')
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('keeps repos non-indexed when manifest description is weak (< 40 chars)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: 'nanoresearch',
        description: 'Short tool',
        plugins: [{ name: 'nanoresearch', source: './' }],
      }),
    } as Response)

    const metadata = await generateMetadata({ params: Promise.resolve({ repo: ['chrisliu298', 'nanoresearch'] }) })

    expect(metadata.description).toBe('Short tool')
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })
})
