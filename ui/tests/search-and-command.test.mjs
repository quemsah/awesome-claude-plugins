/** biome-ignore-all lint/style/useNamingConvention: GitHub repository fixtures use API field names. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFuseIndex, fuseOptions } from '../src/lib/fuzzySearch.ts'
import { getInstallCommand } from '../src/lib/installCommand.ts'

const repos = [
  {
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
  },
  {
    html_url: 'https://github.com/acme/other',
    stargazers_count: 1,
    forks_count: 0,
    subscribers_count: 1,
    description: 'Different project',
    owner: 'acme',
    owner_url: 'https://github.com/acme',
    repo_name: 'other',
    plugins_count: null,
    id: 2,
  },
]

test('fuseOptions indexes repository names and descriptions', () => {
  assert.deepEqual(fuseOptions.keys, ['repo_name', 'description'])
})

test('createFuseIndex can find repositories by configured fields', () => {
  const fuse = createFuseIndex(repos)
  const results = fuse.search('utilities')

  assert.equal(results[0].item.repo_name, 'claude-tools')
})

test('getInstallCommand prefers plugin ids over repository suffixes', () => {
  assert.equal(getInstallCommand('My Plugin', 'plugin-id', 'acme/claude-tools'), '/plugin install my-plugin@plugin-id')
})

test('getInstallCommand falls back to repository suffixes', () => {
  assert.equal(getInstallCommand('My Plugin', undefined, 'acme/claude-tools'), '/plugin install my-plugin@acme-claude-tools')
})
