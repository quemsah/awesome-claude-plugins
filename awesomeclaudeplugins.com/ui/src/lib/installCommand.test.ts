import { describe, expect, it } from 'vitest'
import {
  getDirectPluginInstallCommand,
  getMarketplaceAddCommand,
  getPluginInstallCommand,
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

describe('getDirectPluginInstallCommand', () => {
  it('installs a marketplace plugin in one command without registering it separately', () => {
    expect(
      getDirectPluginInstallCommand({
        pluginId: 'example-plugin',
        pluginName: 'Example Plugin',
        owner: 'ykdojo',
        repoName: 'claude-code-tips',
      })
    ).toBe('/plugin install example-plugin --marketplace ykdojo/claude-code-tips')
  })

  it('works for Anthropic-owned repositories without special-case marketplace detection', () => {
    expect(
      getDirectPluginInstallCommand({
        pluginId: 'community-plugin',
        owner: 'anthropics',
        repoName: 'claude-plugins-community',
      })
    ).toBe('/plugin install community-plugin --marketplace anthropics/claude-plugins-community')
  })

  it('falls back to a safe normalized plugin name when the plugin ID is absent', () => {
    expect(getDirectPluginInstallCommand({ pluginName: '  Nice  Plugin ', owner: 'example', repoName: 'plugins' })).toBe(
      '/plugin install nice-plugin --marketplace example/plugins'
    )
  })

  it('rejects missing and malicious repository identifiers and plugin IDs', () => {
    expect(getDirectPluginInstallCommand({ pluginId: 'safe', owner: 'owner' })).toBeNull()
    expect(getDirectPluginInstallCommand({ pluginId: 'safe', owner: 'owner', repoName: 'repo\n/plugin exploit' })).toBeNull()
    expect(getDirectPluginInstallCommand({ pluginId: 'bad/name', owner: 'owner', repoName: 'repo' })).toBeNull()
    expect(getDirectPluginInstallCommand({ pluginName: 'bad/name', owner: 'owner', repoName: 'repo' })).toBeNull()
  })
})
