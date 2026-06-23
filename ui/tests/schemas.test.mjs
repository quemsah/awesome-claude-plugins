/** biome-ignore-all lint/style/useNamingConvention: GitHub repository fixtures use API field names. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PluginManifestSchema, PluginSchema } from '../src/schemas/plugin.schema.ts'
import { RepoSchema } from '../src/schemas/repo.schema.ts'
import { StatsItemSchema } from '../src/schemas/stats.schema.ts'

const validRepo = {
  html_url: 'https://github.com/acme/claude-tools',
  stargazers_count: 10,
  forks_count: 2,
  subscribers_count: 3,
  description: 'Utilities for Claude plugins',
  owner: 'acme',
  owner_url: 'https://github.com/acme',
  repo_name: 'claude-tools',
  plugins_count: 1,
  id: 1,
}

test('RepoSchema accepts valid repository data', () => {
  assert.equal(RepoSchema.safeParse(validRepo).success, true)
})

test('RepoSchema rejects invalid repository URLs', () => {
  assert.equal(RepoSchema.safeParse({ ...validRepo, html_url: 'not-a-url' }).success, false)
})

test('StatsItemSchema accepts ISO datetime snapshots', () => {
  assert.equal(StatsItemSchema.safeParse({ date: '2026-06-23T00:00:00.000Z', size: 42 }).success, true)
})

test('StatsItemSchema rejects invalid dates', () => {
  assert.equal(StatsItemSchema.safeParse({ date: '2026-06-23', size: 42 }).success, false)
})

test('PluginSchema accepts plugin metadata', () => {
  const result = PluginSchema.safeParse({
    name: 'Example Plugin',
    id: 'example-plugin',
    source: { repo: 'acme/claude-tools', source: '.claude-plugin/plugin.json' },
    author: { name: 'Acme', email: 'dev@example.com' },
    commands: ['commands/example.md'],
  })

  assert.equal(result.success, true)
})

test('PluginManifestSchema accepts array and object manifest shapes', () => {
  const plugin = { name: 'Example Plugin', id: 'example-plugin' }

  assert.equal(PluginManifestSchema.safeParse([plugin]).success, true)
  assert.equal(PluginManifestSchema.safeParse({ plugins: [plugin] }).success, true)
})
