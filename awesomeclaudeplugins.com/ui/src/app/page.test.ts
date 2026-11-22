import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import StructuredData from '../components/search/StructuredData.tsx'
import { TitleSection } from '../components/search/TitleSection.tsx'
import { BASE_URL } from '../lib/constants.ts'
import { HOME_PAGE_DESCRIPTION, HOME_PAGE_TITLE } from '../lib/homePageMetadata.ts'
import { generateMetadata } from './page.tsx'

describe('homepage metadata', () => {
  it('sets directory intent consistently across page, Open Graph, Twitter, and WebSite metadata', async () => {
    const metadata = await generateMetadata({})

    expect(metadata.title).toEqual({ absolute: HOME_PAGE_TITLE })
    expect(metadata.description).toBe(HOME_PAGE_DESCRIPTION)
    expect(metadata.openGraph).toMatchObject({
      description: HOME_PAGE_DESCRIPTION,
      title: HOME_PAGE_TITLE,
      url: BASE_URL,
    })
    expect(metadata.twitter).toMatchObject({
      description: HOME_PAGE_DESCRIPTION,
      title: HOME_PAGE_TITLE,
    })

    const structuredData = renderToStaticMarkup(createElement(StructuredData, { repos: [] }))
    expect(structuredData).toContain(`"description":${JSON.stringify(HOME_PAGE_DESCRIPTION)}`)
  })

  it('keeps the homepage canonical while noindexing query variants', async () => {
    const homepage = await generateMetadata({})
    expect(homepage.alternates?.canonical).toBe(`${BASE_URL}/`)

    for (const searchParams of [{ q: 'mcp' }, { sort: 'stars-desc' }]) {
      const searchMetadata = await generateMetadata({ searchParams: Promise.resolve(searchParams) })
      expect(searchMetadata.alternates?.canonical).toBe(`${BASE_URL}/`)
      expect(searchMetadata.robots).toEqual({
        index: false,
        follow: true,
        googleBot: {
          index: false,
          follow: true,
        },
      })
    }
  })

  it('shows the directory explanation with the snapshot date and methodology link', () => {
    const markup = renderToStaticMarkup(createElement(TitleSection))

    expect(markup).toContain('<h1')
    expect(markup).toContain('>Claude Code Plugin Directory</h1>')
    expect(markup).toContain(HOME_PAGE_DESCRIPTION)
    expect(markup).toContain('Catalog snapshot:')
    expect(markup).toContain('Read the methodology and correction policy.')
    expect(markup).toContain('href="/about"')
  })
})
