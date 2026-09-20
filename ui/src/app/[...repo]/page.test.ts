import { describe, expect, it } from 'vitest'
import { generateMetadata } from './page.tsx'

const detailImagePattern = /\/og\/ykdojo\/claude-code-tips$/

describe('generateMetadata', () => {
  it('includes the detail page Open Graph image', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ repo: ['ykdojo', 'claude-code-tips'] }) })

    expect(metadata.openGraph).toMatchObject({
      images: [{ url: expect.stringMatching(detailImagePattern) }],
    })
  })
})
