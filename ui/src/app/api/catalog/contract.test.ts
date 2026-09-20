import { describe, expect, it } from 'vitest'
import { catalogApiContract } from '../../../lib/discovery.ts'
import { GET } from './route.ts'

async function get(search: string) {
  const response = await GET(new Request(`http://localhost/api/catalog${search}`))

  return {
    body: (await response.json().catch(() => null)) as Record<string, unknown> | null,
    response,
  }
}

/**
 * The published contract in `lib/discovery.ts` is documentation, so it is asserted against the
 * handler rather than against the handler's own constants.
 */
describe('/api/catalog published contract', () => {
  it('answers with exactly the documented envelope and media type', async () => {
    const { body, response } = await get('')

    expect(response.headers.get('content-type')).toBe('application/json')
    expect(Object.keys(body ?? {}).sort()).toEqual([...catalogApiContract.responseFields].sort())
    expect(body?.repos).toHaveLength(catalogApiContract.defaultPageSize)
  })

  it('accepts the largest documented page and rejects one above it', async () => {
    const largest = await get(`?pageSize=${catalogApiContract.maxPageSize}`)
    const oversized = await get(`?pageSize=${catalogApiContract.maxPageSize + 1}`)

    expect(largest.response.status).toBe(200)
    expect(oversized.response.status).toBe(400)
    expect(oversized.body).toEqual({ message: 'Invalid pagination parameters' })
  })

  it('rejects a negative page', async () => {
    const { response } = await get('?page=-1')

    expect(response.status).toBe(400)
  })

  it('falls back to the default order for an undocumented sort value', async () => {
    const documented = catalogApiContract.sortOptions.join(', ')

    expect(documented).toContain('stars-desc')
    expect((await get('?sort=alphabetical')).body?.repos).toEqual((await get('')).body?.repos)
  })

  it('truncates rather than rejects a query longer than the documented cap', async () => {
    const longQuery = `?q=${'claude code plugin marketplace '.repeat(6)}`
    const { response } = await get(longQuery)

    expect(response.status).toBe(200)
  })
})
