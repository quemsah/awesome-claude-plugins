import { describe, expect, it } from 'vitest'
import {
  getCombinedInstallCommand,
  getMarketplaceAddCommand,
  getPluginInstallCommand,
  isOfficialMarketplace,
  isPluginInstallCommandVerified,
  normalizePluginName,
} from './installCommand.ts'

describe('normalizePluginName', () => {
  it('normalizes plugin names by trimming, lowercasing, and replacing spaces with hyphens', () => {
    expect(normalizePluginName('  My   Plugin  ')).toBe('my-plugin')
    expect(normalizePluginName('hello-world')).toBe('hello-world')
  })

  it('returns an empty string when the input contains illegal characters', () => {
    expect(normalizePluginName('bad/name')).toBe('')
    expect(normalizePluginName('bad$name')).toBe('')
    expect(normalizePluginName(undefined)).toBe('')
  })
})

describe('isPluginInstallCommandVerified', () => {
  it('returns true when both pluginName and marketplaceName are safe tokens', () => {
    expect(isPluginInstallCommandVerified('my-plugin', 'my-marketplace')).toBe(true)
  })

  it('returns false when marketplaceName is missing or invalid', () => {
    expect(isPluginInstallCommandVerified('my-plugin', undefined)).toBe(false)
    expect(isPluginInstallCommandVerified('my-plugin', 'bad/marketplace')).toBe(false)
    expect(isPluginInstallCommandVerified(undefined, 'marketplace')).toBe(false)
  })
})

describe('getPluginInstallCommand', () => {
  it('generates a verified install command using pluginId and marketplaceName', () => {
    expect(
      getPluginInstallCommand({
        pluginId: 'my-plugin-id',
        pluginName: 'Display Name',
        marketplaceName: 'community',
      })
    ).toBe('/plugin install my-plugin-id@community')
  })

  it('falls back to normalized pluginName if pluginId is omitted', () => {
    expect(
      getPluginInstallCommand({
        pluginName: 'Super Tool',
        marketplaceName: 'community',
      })
    ).toBe('/plugin install super-tool@community')
  })

  it('returns an unverified command when marketplaceName is absent', () => {
    expect(getPluginInstallCommand({ pluginName: 'standalone-tool' })).toBe('/plugin install standalone-tool')
  })

  it('returns null when inputs are invalid or missing', () => {
    expect(getPluginInstallCommand({})).toBeNull()
    expect(getPluginInstallCommand({ pluginName: 'bad/token', marketplaceName: 'market' })).toBeNull()
  })
})

describe('getMarketplaceAddCommand', () => {
  it('generates a marketplace add command from separate owner and repoName', () => {
    expect(getMarketplaceAddCommand('ykdojo', 'claude-code-tips')).toBe('/plugin marketplace add ykdojo/claude-code-tips')
  })

  it('generates a marketplace add command from a combined owner/repo string', () => {
    expect(getMarketplaceAddCommand('ykdojo/claude-code-tips')).toBe('/plugin marketplace add ykdojo/claude-code-tips')
  })

  it('returns null for missing or invalid parameters', () => {
    expect(getMarketplaceAddCommand(null, null)).toBeNull()
    expect(getMarketplaceAddCommand('invalid/owner/extra')).toBeNull()
    expect(getMarketplaceAddCommand('owner', 'repo\n/plugin exploit')).toBeNull()
  })
})

describe('isOfficialMarketplace', () => {
  it('identifies Anthropic official repositories by owner', () => {
    expect(isOfficialMarketplace({ owner: 'anthropics', repoName: 'claude-plugins-official' })).toBe(true)
    expect(isOfficialMarketplace({ owner: 'Anthropic', repoName: 'custom-repo' })).toBe(true)
    expect(isOfficialMarketplace({ repoPath: 'anthropics/claude-plugins-official' })).toBe(true)
  })

  it('rejects repositories not owned by Anthropic even if repository or marketplace name matches', () => {
    expect(isOfficialMarketplace({ owner: 'someone', repoName: 'claude-plugins-official' })).toBe(false)
    expect(isOfficialMarketplace({ repoPath: 'someone/claude-plugins-official' })).toBe(false)
    expect(isOfficialMarketplace({ marketplaceName: 'claude-plugins-official' })).toBe(false)
    expect(isOfficialMarketplace({ marketplaceName: 'official' })).toBe(false)
  })

  it('returns false for community / third-party marketplaces', () => {
    expect(
      isOfficialMarketplace({
        owner: 'ykdojo',
        repoName: 'claude-code-tips',
        marketplaceName: 'ykdojo',
      })
    ).toBe(false)
    expect(
      isOfficialMarketplace({
        repoPath: 'obra/superpowers',
        marketplaceName: 'superpowers',
      })
    ).toBe(false)
    expect(isOfficialMarketplace(null)).toBe(false)
    expect(isOfficialMarketplace(undefined)).toBe(false)
  })
})

describe('getCombinedInstallCommand', () => {
  it('combines add marketplace and install plugin commands with default newline delimiter', () => {
    expect(getCombinedInstallCommand('/plugin marketplace add ykdojo/claude-code-tips', '/plugin install example-plugin@ykdojo')).toBe(
      '/plugin marketplace add ykdojo/claude-code-tips\n/plugin install example-plugin@ykdojo'
    )
  })

  it('combines commands with custom delimiter if requested', () => {
    expect(
      getCombinedInstallCommand('/plugin marketplace add ykdojo/claude-code-tips', '/plugin install example-plugin@ykdojo', ' && ')
    ).toBe('/plugin marketplace add ykdojo/claude-code-tips && /plugin install example-plugin@ykdojo')
  })

  it('returns single command when only one is available', () => {
    expect(getCombinedInstallCommand(null, '/plugin install plugin@market')).toBe('/plugin install plugin@market')
    expect(getCombinedInstallCommand('/plugin marketplace add owner/repo', null)).toBe('/plugin marketplace add owner/repo')
  })

  it('returns null when neither command is provided', () => {
    expect(getCombinedInstallCommand(null, null)).toBeNull()
  })
})
