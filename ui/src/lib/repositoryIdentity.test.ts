import { describe, expect, it } from 'vitest'
import { encodeGitHubPath, getGitHubBlobUrl } from './repositoryIdentity.ts'

describe('encodeGitHubPath', () => {
  it('keeps the separators that make a repository path addressable', () => {
    expect(encodeGitHubPath('commands/example.md')).toBe('commands/example.md')
    expect(encodeGitHubPath('./commands/linkedin.md')).toBe('./commands/linkedin.md')
    expect(encodeGitHubPath('release/v1.2')).toBe('release/v1.2')
  })

  it('encodes the characters that would end the path early', () => {
    expect(encodeGitHubPath('docs/100%.md')).toBe('docs/100%25.md')
    expect(encodeGitHubPath('scripts/a?b.js')).toBe('scripts/a%3Fb.js')
    expect(encodeGitHubPath('notes/a#b.md')).toBe('notes/a%23b.md')
    expect(encodeGitHubPath('notes/todo list.md')).toBe('notes/todo%20list.md')
    expect(encodeGitHubPath('src/[entry]/index.ts')).toBe('src/%5Bentry%5D/index.ts')
  })

  it('replaces malformed UTF-16 without corrupting valid surrogate pairs', () => {
    expect(encodeGitHubPath('commands/high-\uD800.md')).toBe('commands/high-%EF%BF%BD.md')
    expect(encodeGitHubPath('commands/low-\uDC00.md')).toBe('commands/low-%EF%BF%BD.md')
    expect(encodeGitHubPath('commands/emoji-\uD83D\uDE00.md')).toBe('commands/emoji-%F0%9F%98%80.md')
  })
})

describe('getGitHubBlobUrl', () => {
  it('reproduces a well-formed manifest URL byte for byte', () => {
    // Pinned by `repo-detail.spec.ts`: encoding must not touch paths that need none.
    expect(getGitHubBlobUrl('elsewhere/shared-plugins', 'main', 'plugins/fallback.json')).toBe(
      'https://github.com/elsewhere/shared-plugins/blob/main/plugins/fallback.json'
    )
  })

  it('cannot let a manifest path rewrite the ref it is appended to', () => {
    expect(getGitHubBlobUrl('owner/repo', 'HEAD', 'a?ref=other')).toBe('https://github.com/owner/repo/blob/HEAD/a%3Fref%3Dother')
  })

  it('cannot let a repository segment open a new origin', () => {
    expect(getGitHubBlobUrl('owner/evil.com/x', 'HEAD', 'README.md')).toBe('https://github.com/owner/evil.com/x/blob/HEAD/README.md')
  })
})
