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

  it('does not treat a repoPath-only plugin as verified', () => {
    // A repoPath alone identifies the marketplace, not an installable package name, so the
    // generated command is still rendered but must not be advertised as verified.
    expect(isPluginInstallCommandVerified(undefined, 'owner/repo')).toBe(false)
    expect(getPluginInstallCommand({ pluginName: 'fallback-install-target', repoPath: 'owner/repo' })).toBe(
      '/plugin install fallback-install-target@owner-repo'
    )
  })

  it('derives a plugin name from the repoPath when no other identifier exists', () => {
    expect(getPluginInstallCommand({ repoPath: 'owner/repo' })).toBe('/plugin install repo@owner-repo')
    expect(getPluginInstallCommand({})).toBeNull()
  })
})
