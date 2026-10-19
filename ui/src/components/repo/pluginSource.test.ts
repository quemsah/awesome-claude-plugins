import { describe, expect, it } from 'vitest'
import type { PluginSource as PluginSourceType } from '../../app/types/plugin.type.ts'
import { PluginSource } from './PluginSource.tsx'

function getSourceLink(source: string | PluginSourceType, defaultBranch = 'main') {
  const element = PluginSource({ source, repoPath: 'owner/repo', defaultBranch })
  return element?.props.children[1].props.children
}

describe('PluginSource', () => {
  it('returns null for missing source', () => {
    expect(PluginSource({ repoPath: 'owner/repo' })).toBeNull()
  })

  it('renders relative file path on the default branch', () => {
    const link = getSourceLink('plugins/test.json')
    expect(link.props.href).toBe('https://github.com/owner/repo/blob/main/plugins/test.json')
    expect(link.props['aria-label']).toBe('Open source file plugins/test.json in a new tab')
    expect(link.props.children).toBe('plugins/test.json')
  })

  it('renders github shorthand string source', () => {
    expect(getSourceLink('github:other-owner/other-repo').props.href).toBe('https://github.com/other-owner/other-repo')
  })

  it('renders github source object with ref', () => {
    const link = getSourceLink({ source: 'github', repo: 'other-owner/other-repo', ref: 'v1.0.0' })
    expect(link.props.href).toBe('https://github.com/other-owner/other-repo/tree/v1.0.0')
    expect(link.props['aria-label']).toBe('Open source repository other-owner/other-repo in a new tab')
    expect(link.props.children).toBe('other-owner/other-repo')
  })

  it('opens repository root when github source has no ref', () => {
    expect(getSourceLink({ source: 'github', repo: 'other-owner/other-repo' }).props.href).toBe(
      'https://github.com/other-owner/other-repo'
    )
  })

  it('prefers a pinned sha over a moving ref or branch for github sources', () => {
    const source = {
      source: 'github',
      repo: 'other-owner/other-repo',
      branch: 'develop',
      ref: 'main',
      commit: '0123456789abcdef0123456789abcdef01234567',
      sha: 'abcdef0123456789abcdef0123456789abcdef01',
    }
    expect(getSourceLink(source).props.href).toBe(
      'https://github.com/other-owner/other-repo/tree/abcdef0123456789abcdef0123456789abcdef01'
    )
  })

  it('renders a direct URL source object', () => {
    const link = getSourceLink({ source: 'url', url: 'https://example.com/repo' })
    expect(link.props.href).toBe('https://example.com/repo')
    expect(link.props['aria-label']).toBe('Open source URL https://example.com/repo in a new tab')
  })

  it('links a github git-subdir to the installed SHA, stripping .git and trailing slash', () => {
    const link = getSourceLink({
      source: 'git-subdir',
      url: 'https://github.com/other-owner/other-repo.git/',
      path: 'plugins/my-plugin',
      ref: 'main',
      sha: 'abcdef0123456789abcdef0123456789abcdef01',
    })
    expect(link.props.href).toBe(
      'https://github.com/other-owner/other-repo/tree/abcdef0123456789abcdef0123456789abcdef01/plugins/my-plugin'
    )
    expect(link.props['aria-label']).toBe('Open source directory plugins/my-plugin in a new tab')
  })

  it('links to the repository root for unknown Git hosts instead of a made-up tree route', () => {
    expect(getSourceLink({
      source: 'git-subdir',
      url: 'https://git.example.org/team/repo.git',
      path: 'plugins/my-plugin',
      ref: 'main',
    }).props.href).toBe('https://git.example.org/team/repo')
  })

  it('preserves legacy path-source objects with a separate repo', () => {
    const link = getSourceLink({ source: 'plugins/fallback.json', repo: 'elsewhere/shared-plugins', branch: 'main' })
    expect(link.props.href).toBe('https://github.com/elsewhere/shared-plugins/blob/main/plugins/fallback.json')
    expect(link.props.children).toBe('plugins/fallback.json')
    expect(link.props['aria-label']).toBe('Open source file plugins/fallback.json in a new tab')
  })

  it('preserves legacy URL+path objects with GitHub blob links', () => {
    expect(getSourceLink({
      source: 'plugins/special.json',
      url: 'https://github.com/group/repo.git',
      path: 'plugins/special.json',
      ref: 'main',
    }).props.href).toBe('https://github.com/group/repo/blob/main/plugins/special.json')
  })

  it('returns null for unsupported source object types even if they have repository metadata', () => {
    expect(PluginSource({
      source: { source: 'npm', repo: 'elsewhere/shared-plugins' } as unknown as PluginSourceType,
      repoPath: 'owner/repo',
    })).toBeNull()
  })
})
