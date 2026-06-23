import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getMarketplaceAddCommand, getPluginInstallCommand, normalizePluginName } from '../src/lib/installCommand.ts'

test('normalizePluginName trims, lowercases, and collapses whitespace', () => {
  assert.equal(normalizePluginName('  My   Plugin  '), 'my-plugin')
})

test('getPluginInstallCommand prefers explicit plugin ids when a name is present', () => {
  assert.equal(
    getPluginInstallCommand({ pluginName: 'My Plugin', pluginId: 'plugin-id', repoPath: 'owner/repo' }),
    '/plugin install my-plugin@plugin-id'
  )
})

test('getPluginInstallCommand falls back to repository path suffixes', () => {
  assert.equal(getPluginInstallCommand({ pluginName: 'My Plugin', repoPath: 'owner/repo' }), '/plugin install my-plugin@owner-repo')
})

test('getPluginInstallCommand can install by plugin id only', () => {
  assert.equal(getPluginInstallCommand({ pluginId: 'plugin-id' }), '/plugin install plugin-id')
})

test('getPluginInstallCommand returns null for invalid manifests without identifiers', () => {
  assert.equal(getPluginInstallCommand({}), null)
})

test('getMarketplaceAddCommand requires repository owner and name', () => {
  assert.equal(getMarketplaceAddCommand('owner', 'repo'), '/plugin marketplace add owner/repo')
  assert.equal(getMarketplaceAddCommand('owner', null), null)
})
