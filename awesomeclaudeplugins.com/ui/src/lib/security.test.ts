/** biome-ignore-all lint/style/useNamingConvention: Test fixtures mirror catalog field names. */
import { describe, expect, it } from 'vitest'
import { RepoSchema } from '../schemas/repo.schema.ts'
import { getMarketplaceAddCommand, getPluginInstallCommand, isPluginInstallCommandVerified } from './installCommand.ts'
import { serializeJsonLd } from './jsonLd.ts'
import { getGitHubRepoPath } from './repositoryIdentity.ts'

describe('catalog security boundaries', () => {
  it('rejects path injection in catalog identity segments', () => {
    const result = RepoSchema.safeParse({
      stargazers_count: 1,
      forks_count: 0,
      subscribers_count: 0,
      description: null,
      owner: '\\evil.com',
      repo_name: 'repository',
      plugins_count: 0,
      id: 1,
    })

    expect(result.success).toBe(false)
  })

  it('rejects dot-only GitHub owner and repository segments', () => {
    const validRepo = {
      stargazers_count: 1,
      forks_count: 0,
      subscribers_count: 0,
      description: null,
      owner: 'owner',
      repo_name: 'repository',
      plugins_count: 0,
      id: 1,
    }
    for (const segment of ['.', '..']) {
      expect(RepoSchema.safeParse({ ...validRepo, owner: segment }).success).toBe(false)
      expect(RepoSchema.safeParse({ ...validRepo, repo_name: segment }).success).toBe(false)
    }
    expect(RepoSchema.safeParse(validRepo).success).toBe(true)
    expect(RepoSchema.safeParse({ ...validRepo, repo_name: '.github' }).success).toBe(true)
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

  it('verifies commands only when both plugin and marketplace names are valid', () => {
    expect(isPluginInstallCommandVerified('example-plugin', 'ykdojo')).toBe(true)
    expect(isPluginInstallCommandVerified('bad/name', 'ykdojo')).toBe(false)
    expect(isPluginInstallCommandVerified('example-plugin')).toBe(false)
    expect(isPluginInstallCommandVerified(undefined, 'ykdojo')).toBe(false)
  })

  it('uses a marketplace name when available and leaves name-only commands unverified', () => {
    expect(isPluginInstallCommandVerified('fallback-install-target', 'ykdojo')).toBe(true)
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
