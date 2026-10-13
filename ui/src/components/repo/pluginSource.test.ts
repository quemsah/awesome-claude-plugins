import { describe, expect, it } from 'vitest'
import type { PluginSource as PluginSourceType } from '../../app/types/plugin.type.ts'
import { PluginSource } from './PluginSource.tsx'

describe('PluginSource', () => {
  it('returns null for missing source', () => {
    expect(PluginSource({ repoPath: 'owner/repo' })).toBeNull()
  })

  it('renders relative file path on default branch', () => {
    const element = PluginSource({ source: 'plugins/test.json', repoPath: 'owner/repo', defaultBranch: 'main' })
    expect(element).not.toBeNull()
    const link = element?.props.children[1].props.children
    expect(link.props.href).toBe('https://github.com/owner/repo/blob/main/plugins/test.json')
    expect(link.props['aria-label']).toBe('Open source file plugins/test.json in a new tab')
    expect(link.props.children).toBe('plugins/test.json')
  })

  it('renders github shorthand string source', () => {
    const element = PluginSource({ source: 'github:other-owner/other-repo', repoPath: 'owner/repo' })
    const link = element?.props.children[1].props.children
    expect(link.props.href).toBe('https://github.com/other-owner/other-repo')
  })

  it('renders github source object with ref', () => {
    const element = PluginSource({
      source: { source: 'github', repo: 'other-owner/other-repo', ref: 'v1.0.0' },
      repoPath: 'owner/repo',
    })
    const link = element?.props.children[1].props.children
    expect(link.props.href).toBe('https://github.com/other-owner/other-repo/tree/v1.0.0')
    expect(link.props['aria-label']).toBe('Open source repository other-owner/other-repo in a new tab')
  })

  it('renders github source object without ref as repo root', () => {
    const element = PluginSource({
      source: { source: 'github', repo: 'other-owner/other-repo' },
      repoPath: 'owner/repo',
    })
    const link = element?.props.children[1].props.children
    expect(link.props.href).toBe('https://github.com/other-owner/other-repo')
  })

  it('renders url source object', () => {
    const element = PluginSource({
      source: { source: 'url', url: 'https://example.com/repo' },
      repoPath: 'owner/repo',
    })
    const link = element?.props.children[1].props.children
    expect(link.props.href).toBe('https://example.com/repo')
    expect(link.props['aria-label']).toBe('Open source URL https://example.com/repo in a new tab')
  })

  it('renders git-subdir source object', () => {
    const element = PluginSource({
      source: {
        source: 'git-subdir',
        url: 'https://github.com/other-owner/other-repo.git',
        path: 'plugins/my-plugin',
        branch: 'main',
      },
      repoPath: 'owner/repo',
    })
    const link = element?.props.children[1].props.children
    expect(link.props.href).toBe('https://github.com/other-owner/other-repo/tree/main/plugins/my-plugin')
  })

  it('returns null for unsupported source object types', () => {
    const element = PluginSource({
      source: { source: 'npm' } as unknown as PluginSourceType,
      repoPath: 'owner/repo',
    })
    expect(element).toBeNull()
  })
})
