/** biome-ignore-all lint/style/useNamingConvention: Test fixtures mirror GitHub API field names. */
import { describe, expect, it } from 'vitest'
import { readLiveRepository } from './liveRepository.ts'

const requested = { owner: 'example-owner', repoName: 'example-repo' }

const liveRepository = {
  created_at: '2026-01-01T00:00:00Z',
  default_branch: 'main',
  description: 'A repository served live by the GitHub API',
  forks_count: 2,
  html_url: 'https://github.com/example-owner/example-repo',
  homepage: 'https://example.dev/example-repo',
  language: 'TypeScript',
  license: { name: 'MIT' },
  name: 'example-repo',
  open_issues_count: 1,
  owner: {
    avatar_url: 'https://avatars.githubusercontent.com/u/1',
    html_url: 'https://github.com/example-owner',
    login: 'example-owner',
    type: 'User',
  },
  pushed_at: '2026-01-02T00:00:00Z',
  size: 2048,
  stargazers_count: 7,
  subscribers_count: 3,
  topics: ['claude-code', 'plugins'],
  updated_at: '2026-01-02T00:00:00Z',
}

describe('readLiveRepository', () => {
  it('returns the live repository for a matching 200 response', () => {
    expect(readLiveRepository(200, liveRepository, requested)).toEqual({
      ok: true,
      repository: expect.objectContaining({ name: 'example-repo', stargazers_count: 7 }),
    })
  })

  it('reports the repository as missing for a 404 response', () => {
    expect(readLiveRepository(404, { message: 'Not Found' }, requested)).toEqual({ ok: false, reason: 'github-not-found' })
  })

  it('keeps the catalog data for a failed request', () => {
    expect(readLiveRepository(500, { message: 'Server Error' }, requested)).toEqual({ ok: false, reason: 'github-unavailable' })
  })

  it.each([403, 500])('rejects a schema-valid repository returned with HTTP %s', (status) => {
    expect(readLiveRepository(status, liveRepository, requested)).toEqual({ ok: false, reason: 'github-unavailable' })
  })

  it('keeps the catalog data for a payload that is not a repository', () => {
    const notARepository = { ...liveRepository, owner: undefined }

    expect(readLiveRepository(200, notARepository, requested)).toEqual({ ok: false, reason: 'github-unavailable' })
  })

  it('keeps the catalog data when GitHub answers with a different repository', () => {
    const movedRepository = {
      ...liveRepository,
      html_url: 'https://github.com/new-owner/example-repo',
      owner: { ...liveRepository.owner, html_url: 'https://github.com/new-owner', login: 'new-owner' },
    }

    expect(readLiveRepository(200, movedRepository, requested)).toEqual({ ok: false, reason: 'github-unavailable' })
  })
})
