/** biome-ignore-all lint/style/useNamingConvention: Test fixtures mirror GitHub API field names. */
import { describe, expect, it } from 'vitest'
import { GitHubRepositorySchema } from './github.schema.ts'

const validRepository = {
  created_at: '2026-01-01T00:00:00Z',
  default_branch: 'main',
  description: 'A repository used by the schema tests',
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
  topics: ['claude-code', 'plugins'],
  updated_at: '2026-01-02T00:00:00Z',
}

describe('GitHubRepositorySchema', () => {
  it('accepts the minimum repository payload and applies safe defaults', () => {
    const result = GitHubRepositorySchema.safeParse(validRepository)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.subscribers_count).toBe(0)
      expect(result.data.license?.url).toBeUndefined()
    }
  })

  it('rejects non-HTTP(S) homepage URLs', () => {
    const result = GitHubRepositorySchema.safeParse({
      ...validRepository,
      homepage: 'javascript:alert(1)',
    })

    expect(result.success).toBe(false)
  })

  it('rejects GitHub links that do not match the repository identity', () => {
    const result = GitHubRepositorySchema.safeParse({
      ...validRepository,
      html_url: 'https://github.com/another-owner/example-repo',
    })

    expect(result.success).toBe(false)
  })

  it('rejects malformed owner, license, and topic values', () => {
    const result = GitHubRepositorySchema.safeParse({
      ...validRepository,
      license: { name: '' },
      owner: { ...validRepository.owner, login: 'owner/name' },
      topics: ['valid-topic', 42],
    })

    expect(result.success).toBe(false)
  })
})
