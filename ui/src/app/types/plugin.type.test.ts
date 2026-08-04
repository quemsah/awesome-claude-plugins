import { describe, expect, it } from 'vitest'
import { MarketplacePluginsSchema } from './plugin.type.ts'

describe('MarketplacePluginsSchema', () => {
  it('accepts current Claude marketplace source objects', () => {
    const result = MarketplacePluginsSchema.safeParse({
      plugins: [
        {
          name: 'official-plugin',
          source: {
            source: 'git-subdir',
            url: 'https://github.com/example-owner/example-repo.git',
            path: 'plugins/official-plugin',
            ref: 'main',
            sha: '30287f5e3f122a646d1ac5ca3ab96e130c52a3ad',
          },
          skills: ['./skills/official-plugin'],
          lspServers: { typescript: {} },
        },
      ],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data[0]?.source).toEqual({
        source: 'git-subdir',
        url: 'https://github.com/example-owner/example-repo.git',
        path: 'plugins/official-plugin',
        ref: 'main',
        sha: '30287f5e3f122a646d1ac5ca3ab96e130c52a3ad',
      })
    }
  })

  it('rejects source URLs with embedded credentials', () => {
    const result = MarketplacePluginsSchema.safeParse({
      plugins: [{ name: 'unsafe-plugin', source: { source: 'url', url: 'https://user:pass@example.com/plugin.git' } }],
    })

    expect(result.success).toBe(false)
  })

  it('accepts common marketplace wrappers and a single plugin entry', () => {
    const wrapped = MarketplacePluginsSchema.safeParse({
      marketplace: {
        plugins: [{ name: 'wrapped-plugin', source: './plugins/wrapped-plugin' }],
      },
    })
    const repositories = MarketplacePluginsSchema.safeParse({
      repositories: [{ name: 'repository-plugin', source: './plugins/repository-plugin' }],
    })
    const single = MarketplacePluginsSchema.safeParse({
      name: 'single-plugin',
      source: './plugins/single-plugin',
    })

    expect(wrapped.success && wrapped.data[0]?.name).toBe('wrapped-plugin')
    expect(repositories.success && repositories.data[0]?.name).toBe('repository-plugin')
    expect(single.success && single.data[0]?.name).toBe('single-plugin')
  })

  it('treats skill-only metadata as an empty plugin list', () => {
    const result = MarketplacePluginsSchema.safeParse({ skills: { pgns: { name: 'pgns' } }, strict: false })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual([])
  })

  it('accepts MCP server maps and non-standard author email values', () => {
    const result = MarketplacePluginsSchema.safeParse({
      plugins: [
        {
          name: 'firebase',
          author: { name: 'Firebase', email: 'support at firebase' },
          mcpServers: { firebase: { command: 'npx' } },
          source: './',
        },
      ],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data[0]?.name).toBe('firebase')
      expect(result.data[0]?.mcpServers).toBeUndefined()
    }
  })
})
