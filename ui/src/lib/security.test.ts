/** biome-ignore-all lint/style/useNamingConvention: Test fixtures mirror catalog field names. */
import { describe, expect, it } from 'vitest'
import { RepoSchema } from '../schemas/repo.schema.ts'
import { getMarketplaceAddCommand, getPluginInstallCommand, isPluginInstallCommandVerified } from './installCommand.ts'
import { serializeJsonLd } from './jsonLd.ts'
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
    expect(getPluginInstallCommand({ pluginId: 'plugin\nexploit', pluginName: 'plugin' })).toBeNull()
  })
})

describe('install command verification', () => {
  it('treats only a well-formed pluginId as verified', () => {
    expect(isPluginInstallCommandVerified('example-plugin')).toBe(true)
    expect(isPluginInstallCommandVerified('plugin\nexploit')).toBe(false)
    expect(isPluginInstallCommandVerified(undefined)).toBe(false)
    expect(isPluginInstallCommandVerified('')).toBe(false)
  })

  it('uses a marketplace name when pluginId is absent', () => {
    expect(isPluginInstallCommandVerified(undefined, 'ykdojo')).toBe(true)
    expect(getPluginInstallCommand({ pluginName: 'fallback-install-target', marketplaceName: 'ykdojo' })).toBe(
      '/plugin install fallback-install-target@ykdojo'
    )
    expect(isPluginInstallCommandVerified(undefined, 'bad/name')).toBe(false)
  })

  it('does not let a valid marketplace name hide an invalid pluginId', () => {
    expect(isPluginInstallCommandVerified('bad id', 'ykdojo')).toBe(false)
    expect(getPluginInstallCommand({ pluginId: 'bad id', pluginName: 'plugin', marketplaceName: 'ykdojo' })).toBeNull()
  })

  it('does not derive an install target from a repository path', () => {
    expect(getPluginInstallCommand({ pluginName: 'fallback-install-target' })).toBe('/plugin install fallback-install-target')
    expect(getPluginInstallCommand({})).toBeNull()
  })
})
