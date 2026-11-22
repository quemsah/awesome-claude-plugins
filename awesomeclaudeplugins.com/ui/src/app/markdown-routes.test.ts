import { describe, expect, it } from 'vitest'

import * as aboutMarkdown from './about.md/route.ts'
import * as homeMarkdown from './index.md/route.ts'
import * as skillMarkdown from './SKILL.md/route.ts'
import * as statsMarkdown from './stats.md/route.ts'

const directRoutes = [
  ['about.md', aboutMarkdown.GET],
  ['index.md', homeMarkdown.GET],
  ['SKILL.md', skillMarkdown.GET],
  ['stats.md', statsMarkdown.GET],
] as const

describe('direct Markdown routes', () => {
  it.each(directRoutes)('%s remains available and carries X-Robots-Tag noindex', (_path, get) => {
    const response = get()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('x-robots-tag')).toBe('noindex')
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
  })
})
