/** biome-ignore-all lint/style/useNamingConvention: Test fixture mirrors catalog field names. */

import { describe, expect, it } from 'vitest'
import { createFuseIndex } from './fuzzySearch.ts'

const baseRepo = {
  html_url: 'https://github.com/example/type-detector',
  stargazers_count: 10,
  forks_count: 1,
  subscribers_count: 1,
  description: 'Reports the types of incoming requests',
  owner: 'schema-sift',
  owner_url: 'https://github.com/owner-url-only',
  repo_name: 'type-detector',
  plugins_count: 2,
  id: 1,
} as const

describe('createFuseIndex', () => {
  it('searches every catalog field the index is configured with', () => {
    const fuse = createFuseIndex([baseRepo])
    expect(fuse.search('detector')).toHaveLength(1)
    expect(fuse.search('sift')).toHaveLength(1)
    expect(fuse.search('incoming requests')).toHaveLength(1)
  })

  it('does not search the URL columns', () => {
    const fuse = createFuseIndex([baseRepo])
    expect(fuse.search('example')).toHaveLength(0)
    expect(fuse.search('owner-url-only')).toHaveLength(0)
  })
})
