import { describe, expect, it } from 'vitest'
import { BASE_URL } from '../../../lib/constants.ts'
import { API_CATALOG_MEDIA_TYPE, API_CATALOG_PROFILE_URI, apiCatalogLinks } from '../../../lib/discovery.ts'
import { GET } from './route.ts'

type Linkset = { anchor: string } & Record<string, unknown>

async function readCatalog() {
  const response = GET()
  const body = (await response.json()) as { linkset: Linkset[] }

  return { body, response }
}

describe('/.well-known/api-catalog', () => {
  it('declares the RFC 9727 conformance profile on the linkset media type', async () => {
    const { response } = await readCatalog()

    expect(response.headers.get('content-type')).toBe(`${API_CATALOG_MEDIA_TYPE}; charset=utf-8; profile="${API_CATALOG_PROFILE_URI}"`)
  })

  it('groups links by relation type instead of nesting RFC 6573 link objects', async () => {
    const { body } = await readCatalog()
    const [entry] = body.linkset

    expect(body.linkset).toHaveLength(1)
    expect(entry.anchor).toBe(BASE_URL)
    expect(entry).not.toHaveProperty('link')

    for (const { rel, href } of apiCatalogLinks) {
      expect(entry[rel]).toEqual(expect.arrayContaining([expect.objectContaining({ href })]))
    }
  })

  it('lists every member API with the item relation', async () => {
    const { body } = await readCatalog()
    const items = body.linkset[0].item as { href: string; type: string }[]

    expect(items.map((item) => item.href)).toEqual(expect.arrayContaining([`${BASE_URL}/api/catalog`, `${BASE_URL}/feed.json`]))
    expect(items.every((item) => item.type && item.href.startsWith(BASE_URL))).toBe(true)
  })
})
