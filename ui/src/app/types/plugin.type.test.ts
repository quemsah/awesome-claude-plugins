import { describe, expect, it } from 'vitest'
import { getMarketplaceDescription, getMarketplaceName, MarketplacePluginsSchema } from './plugin.type.ts'

describe('MarketplacePluginsSchema', () => {
  it('reads supported plugin fields for display', () => {
    const payload = { name: 'catalog', plugins: [{ name: 'plugin', source: './plugins/plugin' }] }
    const result = MarketplacePluginsSchema.safeParse(payload)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toHaveLength(1)
    expect(getMarketplaceName(payload)).toBe('catalog')
  })

  it('extracts marketplace names only from marketplace wrappers', () => {
    expect(getMarketplaceName({ name: 'ykdojo', plugins: [{ name: 'dx', source: './' }] })).toBe('ykdojo')
    expect(getMarketplaceName({ marketplace: { name: 'nested-market', plugins: [{ name: 'nested-plugin' }] } })).toBe('nested-market')
    expect(getMarketplaceName({ name: 'single-plugin', source: './plugins/single-plugin' })).toBeUndefined()
    expect(getMarketplaceName({ name: 'bad/name', plugins: [] })).toBeUndefined()
  })

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

  it('rejects traversal in source object fallback paths', () => {
    const result = MarketplacePluginsSchema.safeParse({
      plugins: [
        {
          name: 'unsafe-plugin',
          source: { source: '../../../../attacker/repo', repo: 'elsewhere/shared-plugins', branch: 'main' },
        },
      ],
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

describe('getMarketplaceDescription', () => {
  it('extracts top-level description when present and strong', () => {
    const payload = {
      name: 'marketplace',
      description: 'A curated marketplace of powerful developer plugins for Claude Code workflows.',
      plugins: [],
    }
    expect(getMarketplaceDescription(payload)).toBe(payload.description)
  })

  it('extracts nested marketplace description', () => {
    const payload = {
      marketplace: {
        name: 'nested',
        description: 'Nested marketplace description that is long enough to meet requirements.',
        plugins: [],
      },
    }
    expect(getMarketplaceDescription(payload)).toBe(payload.marketplace.description)
  })

  it('prefers strong plugin description over short top-level description', () => {
    const pluginDescription = 'A dedicated plugin description that is at least forty characters long.'
    const payload = {
      name: 'marketplace',
      description: 'Short',
      plugins: [{ name: 'plugin', description: pluginDescription, source: './' }],
    }
    expect(getMarketplaceDescription(payload)).toBe(pluginDescription)
  })

  it('extracts plugin description when top-level description is missing', () => {
    const pluginDescription = 'A dedicated plugin description that is at least forty characters long.'
    const payload = {
      name: 'marketplace',
      plugins: [{ name: 'plugin', description: pluginDescription, source: './' }],
    }
    expect(getMarketplaceDescription(payload)).toBe(pluginDescription)
  })

  it('extracts description from a single plugin payload', () => {
    const payload = {
      name: 'single-plugin',
      description: 'Single plugin standalone manifest description meeting forty characters.',
      source: './',
    }
    expect(getMarketplaceDescription(payload)).toBe(payload.description)
  })

  it('extracts short description when no strong description is available', () => {
    expect(getMarketplaceDescription({ name: 'marketplace', description: 'Short' })).toBe('Short')
    expect(getMarketplaceDescription({ plugins: [{ name: 'plugin', description: 'Short', source: './' }] })).toBe('Short')
  })

  it('returns undefined when no description is present', () => {
    expect(getMarketplaceDescription(null)).toBeUndefined()
    expect(getMarketplaceDescription({})).toBeUndefined()
    expect(getMarketplaceDescription({ name: 'marketplace', plugins: [{ name: 'plugin', source: './' }] })).toBeUndefined()
  })
})
