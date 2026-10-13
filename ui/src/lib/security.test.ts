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
    expect(getPluginInstallCommand({ pluginName: 'plugin\nexploit', marketplaceName: 'ykdojo' })).toBeNull()
  })
})

describe('install command verification', () => {
  it('treats only a well-formed marketplace name as verified', () => {
    expect(isPluginInstallCommandVerified('ykdojo')).toBe(true)
    expect(isPluginInstallCommandVerified('bad/name')).toBe(false)
    expect(isPluginInstallCommandVerified(undefined)).toBe(false)
    expect(isPluginInstallCommandVerified('')).toBe(false)
  })

  it('uses the marketplace name as the install target suffix', () => {
    expect(isPluginInstallCommandVerified('ykdojo')).toBe(true)
    expect(getPluginInstallCommand({ pluginName: 'fallback-install-target', marketplaceName: 'ykdojo' })).toBe(
      '/plugin install fallback-install-target@ykdojo'
    )
    expect(isPluginInstallCommandVerified('bad/name')).toBe(false)
  })

  it('rejects an invalid marketplace name instead of generating a command', () => {
    expect(getPluginInstallCommand({ pluginName: 'plugin', marketplaceName: 'bad/name' })).toBeNull()
  })

  it('does not derive an install target from a repository path', () => {
    expect(getPluginInstallCommand({ pluginName: 'FallbackInstallTarget' })).toBe('/plugin install FallbackInstallTarget')
    expect(getPluginInstallCommand({})).toBeNull()
  })
})
