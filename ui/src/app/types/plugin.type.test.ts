import { describe, expect, it } from 'vitest'
import { getMarketplaceName, MarketplacePluginsSchema } from './plugin.type.ts'

describe('MarketplacePluginsSchema', () => {
  it('reads supported plugin fields for display', () => {
    const payload = { name: 'catalog', owner: { name: 'maintainer' }, plugins: [{ name: 'plugin', source: './plugins/plugin' }] }
    const result = MarketplacePluginsSchema.safeParse(payload)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toHaveLength(1)
    expect(getMarketplaceName(payload)).toBe('catalog')
  })

  it('extracts marketplace names only from marketplace wrappers', () => {
    expect(getMarketplaceName({ name: 'ykdojo', plugins: [{ name: 'dx', source: './' }] })).toBe('ykdojo')
    expect(getMarketplaceName({ marketplace: { name: 'nested-market', plugins: [{ name: 'nested-plugin' }] } })).toBeUndefined()
    expect(getMarketplaceName({ name: 'single-plugin', source: './plugins/single-plugin' })).toBeUndefined()
    expect(getMarketplaceName({ name: 'bad/name', plugins: [] })).toBeUndefined()
  })

  it('accepts current Claude marketplace source objects', () => {
    const result = MarketplacePluginsSchema.safeParse({
      name: 'catalog',
      owner: { name: 'maintainer' },
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

  it('skips source URLs with embedded credentials', () => {
    const result = MarketplacePluginsSchema.safeParse({
      name: 'catalog',
      owner: { name: 'maintainer' },
      plugins: [{ name: 'unsafe-plugin', source: { source: 'url', url: 'https://user:pass@example.com/plugin.git' } }],
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual([])
  })

  it('skips traversal in source object fallback paths', () => {
    const result = MarketplacePluginsSchema.safeParse({
      name: 'catalog',
      owner: { name: 'maintainer' },
      plugins: [
        {
          name: 'unsafe-plugin',
          source: { source: '../../../../attacker/repo', repo: 'elsewhere/shared-plugins', branch: 'main' },
        },
      ],
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual([])
  })

  it('rejects marketplace shapes that do not follow the canonical root contract', () => {
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

    expect(wrapped.success).toBe(false)
    expect(repositories.success).toBe(false)
    expect(single.success).toBe(false)
  })

  it('rejects skill-only metadata without the canonical marketplace root', () => {
    const result = MarketplacePluginsSchema.safeParse({ skills: { pgns: { name: 'pgns' } }, strict: false })

    expect(result.success).toBe(false)
  })

  it('accepts MCP server maps and non-standard author email values', () => {
    const result = MarketplacePluginsSchema.safeParse({
      name: 'catalog',
      owner: { name: 'maintainer' },
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
