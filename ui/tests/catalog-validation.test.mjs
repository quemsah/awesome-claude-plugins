/** biome-ignore-all lint/style/useNamingConvention: catalog fixtures use checked-in snake_case fields */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateCatalog, validateRepos, validateStats } from '../scripts/validate-catalog.mjs'

describe('catalog validation', () => {
  const repo = {
    html_url: 'https://github.com/owner/repo',
    stargazers_count: 10,
    forks_count: 2,
    subscribers_count: 1,
    description: 'A plugin repository',
    owner: 'owner',
    owner_url: 'https://github.com/owner',
    repo_name: 'repo',
    plugins_count: 1,
    id: 1,
  }

  const stat = { date: '2026-06-22T06:06:29.505Z', size: 1, id: 1 }

  it('accepts valid repository and stats records', () => {
    assert.deepEqual(validateCatalog({ repos: [repo], stats: [stat] }), [])
  })

  it('rejects malformed repository records', () => {
    const errors = validateRepos([
      { ...repo, html_url: 'not-a-url', id: 1 },
      { ...repo, id: 1 },
    ])

    assert(errors.some((error) => error.includes('html_url must be a URL string')))
    assert(errors.some((error) => error.includes('duplicates 1')))
  })

  it('rejects stale stats counts', () => {
    assert.deepEqual(validateCatalog({ repos: [repo, { ...repo, id: 2 }], stats: [stat] }), [
      'stats latest size 1 does not match repo count 2',
    ])
  })

  it('rejects malformed stats records', () => {
    const errors = validateStats([
      { date: 'not-a-date', size: -1, id: 1 },
      { date: stat.date, size: 1, id: 1 },
    ])

    assert(errors.some((error) => error.includes('date must be an ISO date string')))
    assert(errors.some((error) => error.includes('size must be a non-negative integer')))
    assert(errors.some((error) => error.includes('duplicates 1')))
  })
})
