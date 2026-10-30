/** biome-ignore-all lint/style/useNamingConvention: Test fixtures mirror catalog field names. */
import { describe, expect, it } from 'vitest'
import { PluginSchema } from '../app/types/plugin.type.ts'
import { RepoSchema } from '../schemas/repo.schema.ts'
import { getMarketplaceAddCommand, getPluginInstallCommand, isPluginInstallCommandVerified } from './installCommand.ts'
import { serializeJsonLd } from './jsonLd.ts'
import { getMcpBundleUrl } from './mcpBundleUrl.ts'
import { getGitHubRepoPath } from './repositoryIdentity.ts'

describe('catalog security boundaries', () => {
  it('rejects path injection and noncanonical GitHub URLs', () => {
    const result = RepoSchema.safeParse({
      html_url: 'javascript:alert(1)',
      stargazers_count: 1,
      forks_count: 0,
      subscribers_count: 0,
      description: null,
      owner: '\\evil.com',
      owner_url: 'https://github.com/%5Cevil.com',
      repo_name: 'repository',
      plugins_count: 0,
      id: 1,
    })

    expect(result.success).toBe(false)
  })

  it('only generates catalog paths from encoded repository segments', () => {
    expect(getGitHubRepoPath('owner', 'repo')).toBe('owner/repo')
    expect(getGitHubRepoPath('owner name', 'repo name')).toBe('owner%20name/repo%20name')
  })

  it('escapes script-breaking characters in JSON-LD', () => {
    const serialized = serializeJsonLd({ description: '</script><script>alert(1)</script>' })

    expect(serialized).not.toContain('<')
    expect(JSON.parse(serialized)).toEqual({ description: '</script><script>alert(1)</script>' })
  })

  it('refuses unsafe marketplace and install command tokens', () => {
    expect(getMarketplaceAddCommand('owner', 'repo')).toBe('/plugin marketplace add owner/repo')
    expect(getMarketplaceAddCommand('owner', 'repo\n/plugin install exploit')).toBeNull()
    expect(getPluginInstallCommand({ pluginName: 'plugin', marketplaceName: 'bad/name' })).toBeNull()
  })
})

describe('install command verification', () => {
  it('uses the marketplace manifest name as the install suffix', () => {
    expect(getPluginInstallCommand({ pluginName: 'Readable Plugin', marketplaceName: 'actual-marketplace' })).toBe(
      '/plugin install readable-plugin@actual-marketplace'
    )
  })

  it('uses the official marketplace entry name before the display name', () => {
    expect(
      getPluginInstallCommand({ pluginName: 'Review Assistant', pluginId: 'external-reviewer', marketplaceName: 'community-catalog' })
    ).toBe('/plugin install external-reviewer@community-catalog')
  })

  it('uses a marketplace name when pluginId is absent', () => {
    expect(isPluginInstallCommandVerified(undefined, 'ykdojo')).toBe(false)
    expect(getPluginInstallCommand({ pluginName: 'fallback-install-target', marketplaceName: 'ykdojo' })).toBe(
      '/plugin install fallback-install-target@ykdojo'
    )
    expect(getPluginInstallCommand({ pluginName: 'fallback-install-target' })).toBe('/plugin install fallback-install-target')
  })

  it('does not let a valid marketplace name hide an invalid plugin name', () => {
    expect(isPluginInstallCommandVerified('bad/name', 'ykdojo')).toBe(false)
    expect(getPluginInstallCommand({ pluginName: 'bad/name', marketplaceName: 'ykdojo' })).toBeNull()
  })

  it('does not derive an install target from a repository path', () => {
    expect(getPluginInstallCommand({ pluginName: 'fallback-install-target' })).toBe('/plugin install fallback-install-target')
    expect(getPluginInstallCommand({})).toBeNull()
  })
})

describe('MCP server component shapes', () => {
  it('keeps mixed relative paths, inline server maps, and HTTPS MCP bundles', () => {
    const mcpServers = [
      './mcp/servers.json',
      { reviewer: { command: 'node', args: ['./mcp/reviewer.mjs'] } },
      'https://example.com/reviewer.mcpb',
    ]
    const result = PluginSchema.safeParse({ name: 'mixed-mcp', source: './plugins/mixed-mcp', mcpServers })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.mcpServers).toEqual(mcpServers)
  })

  it('rejects non-HTTPS, credential-bearing, or non-bundle MCP URLs', () => {
    for (const url of [
      'http://example.com/server.mcpb',
      'https://user:secret@example.com/server.mcpb',
      'https://example.com/server.zip',
      'https://example.com/server.mcpb?token=secret',
      'javascript:alert(1)',
    ]) {
      expect(PluginSchema.safeParse({ name: 'invalid-url', mcpServers: [url] }).success).toBe(false)
      expect(getMcpBundleUrl(url)).toBeNull()
    }
    expect(getMcpBundleUrl('https://example.com/server.dxt')).toBe('https://example.com/server.dxt')
  })
})
