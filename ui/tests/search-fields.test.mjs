import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getRepoPath, getRepoSearchFieldValue, repoMatchesSearchField } from '../src/lib/searchFields.mjs'

const repo = {
  ['repo_name']: 'claude-toolkit',
  description: 'Useful automation workflows',
  owner: 'ExampleOwner',
  ['plugins_count']: 3,
}

describe('search fields', () => {
  it('matches repository names', () => {
    assert.equal(repoMatchesSearchField(repo, 'toolkit'), true)
  })

  it('matches descriptions', () => {
    assert.equal(repoMatchesSearchField(repo, 'automation'), true)
  })

  it('matches owners', () => {
    assert.equal(repoMatchesSearchField(repo, 'exampleowner'), true)
  })

  it('matches owner/repo paths', () => {
    assert.equal(getRepoPath(repo), 'ExampleOwner/claude-toolkit')
    assert.equal(repoMatchesSearchField(repo, 'exampleowner/claude-toolkit'), true)
  })

  it('matches plugin count labels', () => {
    assert.equal(getRepoSearchFieldValue(repo, 'plugins_count_label'), '3 plugins')
    assert.equal(repoMatchesSearchField(repo, '3 plugins'), true)
  })
})
