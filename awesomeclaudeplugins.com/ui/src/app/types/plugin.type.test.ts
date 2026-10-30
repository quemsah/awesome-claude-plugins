import { describe, expect, it } from 'vitest'
import { getMarketplaceDescription, getMarketplaceName, MarketplacePluginsSchema } from './plugin.type.ts'

describe('MarketplacePluginsSchema', () => {
  it('reads supported plugin fields for display', () => {
    const payload = { name: 'catalog', owner: { name: 'maintainer' }, plugins: [{ name: 'plugin', source: './plugins/plugin' }] }
    const result = MarketplacePluginsSchema.safeParse(payload)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.plugins).toHaveLength(1)
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
      expect(result.data.plugins[0]?.source).toEqual({
        source: 'git-subdir',
        url: 'https://github.com/example-owner/example-repo.git',
        path: 'plugins/official-plugin',
        ref: 'main',
        sha: '30287f5e3f122a646d1ac5ca3ab96e130c52a3ad',
      })
    }
  })

  it('preserves safe optional metadata when another optional field is malformed', () => {
    const result = MarketplacePluginsSchema.safeParse({
      name: 'catalog',
      owner: { name: 'maintainer' },
      plugins: [
        {
          name: 'partial-metadata',
          source: './plugins/partial-metadata',
          description: 'Still visible',
          version: '1.0.0',
          category: 'tools',
          commands: './commands/run.md',
          keywords: [42],
        },
      ],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.invalidPluginCount).toBe(0)
      expect(result.data.plugins).toEqual([
        {
          name: 'partial-metadata',
          source: './plugins/partial-metadata',
          description: 'Still visible',
          version: '1.0.0',
          category: 'tools',
          commands: ['./commands/run.md'],
        },
      ])
    }
  })

  it('rejects dot-segments in GitHub source repository identifiers', () => {
    const result = MarketplacePluginsSchema.safeParse({
      name: 'catalog',
      owner: { name: 'maintainer' },
      plugins: [
        { name: 'parent-owner', source: { source: 'github', repo: '../plugins' } },
        { name: 'parent-repo', source: { source: 'github', repo: 'owner/..' } },
        { name: 'dot-owner', source: { source: 'github', repo: './plugins' } },
        { name: 'valid', source: { source: 'github', repo: 'owner/plugins' } },
      ],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plugins.map((plugin) => plugin.name)).toEqual(['valid'])
      expect(result.data.invalidPluginCount).toBe(3)
    }
  })

  it('skips source URLs with embedded credentials and reports their validation issue', () => {
    const result = MarketplacePluginsSchema.safeParse({
      name: 'catalog',
      owner: { name: 'maintainer' },
      plugins: [{ name: 'unsafe-plugin', source: { source: 'url', url: 'https://user:pass@example.com/plugin.git' } }],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plugins).toEqual([])
      expect(result.data.invalidPluginCount).toBe(1)
      expect(result.data.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ['plugins', 0, 'source'] })]))
    }
  })

  it('skips traversal in source object fallback paths and reports the validation issue', () => {
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
    if (result.success) {
      expect(result.data.plugins).toEqual([])
      expect(result.data.invalidPluginCount).toBe(1)
      expect(result.data.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ['plugins', 0, 'source', 'source'] })]))
    }
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
          commands: { deploy: './commands/deploy.md' },
          mcpServers: { firebase: { command: 'npx' } },
          source: './',
        },
      ],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plugins[0]?.name).toBe('firebase')
      expect(result.data.plugins[0]?.commands).toEqual({ deploy: './commands/deploy.md' })
      expect(result.data.plugins[0]?.mcpServers).toEqual({ firebase: { command: 'npx' } })
    }
  })

  it('normalizes string component paths and keeps object component maps', () => {
    const result = MarketplacePluginsSchema.safeParse({
      name: 'catalog',
      owner: { name: 'maintainer' },
      plugins: [
        {
          name: 'manifest-shapes',
          source: './',
          commands: './commands/run.md',
          agents: './agents/reviewer.md',
          mcpServers: './mcp.json',
        },
      ],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plugins[0]).toMatchObject({
        commands: ['./commands/run.md'],
        agents: ['./agents/reviewer.md'],
        mcpServers: ['./mcp.json'],
      })
    }
  })

  it('keeps valid plugin entries when another entry is invalid and reports it', () => {
    const result = MarketplacePluginsSchema.safeParse({
      name: 'catalog',
      owner: { name: 'maintainer' },
      plugins: [
        { name: 'valid-plugin', source: './plugins/valid-plugin' },
        { name: 'invalid-plugin', source: '../outside' },
      ],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plugins.map((plugin) => plugin.name)).toEqual(['valid-plugin'])
      expect(result.data.invalidPluginCount).toBe(1)
      expect(result.data.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ['plugins', 1, 'source'] })]))
    }
  })
})

describe('getMarketplaceDescription', () => {
  const summary = 'A useful description for a single plugin marketplace repository.'
  it('prefers a marketplace-level description, including short summaries', () => {
    expect(getMarketplaceDescription({ name: 'market', description: 'Short', plugins: [{ name: 'a', description: summary }] })).toBe(
      'Short'
    )
    expect(getMarketplaceDescription({ marketplace: { description: summary, plugins: [] } })).toBe(summary)
  })
  it('uses a single valid plugin description when marketplace metadata is absent', () => {
    expect(getMarketplaceDescription({ plugins: [{ name: 'only-plugin', source: './', description: summary }] })).toBe(summary)
    expect(getMarketplaceDescription({ name: 'only-plugin', source: './', description: summary })).toBe(summary)
  })
  it('does not pick an arbitrary plugin from multi-plugin marketplaces', () => {
    expect(
      getMarketplaceDescription({
        plugins: [
          { name: 'one', source: './one', description: summary },
          { name: 'two', source: './two', description: 'Another unrelated plugin description.' },
        ],
      })
    ).toBeUndefined()
  })
  it('does not use invalid or missing descriptions', () => {
    expect(getMarketplaceDescription(null)).toBeUndefined()
    expect(getMarketplaceDescription({ plugins: [{ name: 'plugin', source: './' }] })).toBeUndefined()
  })
})
