import { describe, expect, it } from 'vitest'
import { getPluginComponentFileUrl } from './pluginComponentUrl.ts'

describe('getPluginComponentFileUrl', () => {
  const marketplaceRepo = 'anthropics/claude-plugins'
  const defaultBranch = 'main'

  describe('relative marketplace sources', () => {
    it('resolves component files from marketplace root', () => {
      expect(getPluginComponentFileUrl('.', marketplaceRepo, defaultBranch, 'commands/test.md')).toBe(
        'https://github.com/anthropics/claude-plugins/blob/main/commands/test.md'
      )
    })

    it('resolves component files from relative subdirectory', () => {
      expect(getPluginComponentFileUrl('./plugins/test', marketplaceRepo, defaultBranch, 'agents/bot.md')).toBe(
        'https://github.com/anthropics/claude-plugins/blob/main/plugins/test/agents/bot.md'
      )
    })

    it('strips leading ./ in component file path', () => {
      expect(getPluginComponentFileUrl('./plugins/test', marketplaceRepo, defaultBranch, './agents/bot.md')).toBe(
        'https://github.com/anthropics/claude-plugins/blob/main/plugins/test/agents/bot.md'
      )
    })

    it('returns null if defaultBranch is missing for relative sources', () => {
      expect(getPluginComponentFileUrl('.', marketplaceRepo, undefined, 'commands/test.md')).toBeNull()
    })
  })

  describe('string github: sources', () => {
    it('resolves github: shorthand sources with HEAD ref', () => {
      expect(getPluginComponentFileUrl('github:owner/repo', marketplaceRepo, defaultBranch, 'commands/run.md')).toBe(
        'https://github.com/owner/repo/blob/HEAD/commands/run.md'
      )
    })

    it('strips .git suffix from github repository', () => {
      expect(getPluginComponentFileUrl('github:owner/repo.git', marketplaceRepo, defaultBranch, 'commands/run.md')).toBe(
        'https://github.com/owner/repo/blob/HEAD/commands/run.md'
      )
    })
  })

  describe('github object sources', () => {
    it('resolves object source with repo and default HEAD ref', () => {
      expect(getPluginComponentFileUrl({ source: 'github', repo: 'external/plugin' }, marketplaceRepo, defaultBranch, 'mcp.json')).toBe(
        'https://github.com/external/plugin/blob/HEAD/mcp.json'
      )
    })

    it('resolves object source with branch ref and subpath', () => {
      expect(
        getPluginComponentFileUrl(
          { source: 'github', repo: 'external/plugin', branch: 'v1.0', path: 'pkg/sub' },
          marketplaceRepo,
          defaultBranch,
          'commands/run.md'
        )
      ).toBe('https://github.com/external/plugin/blob/v1.0/pkg/sub/commands/run.md')
    })

    it('resolves object source using url and sha ref', () => {
      expect(
        getPluginComponentFileUrl(
          { source: 'github', url: 'https://github.com/external/plugin', sha: 'abcdef12' },
          marketplaceRepo,
          defaultBranch,
          'commands/run.md'
        )
      ).toBe('https://github.com/external/plugin/blob/abcdef12/commands/run.md')
    })

    it('prefers pinned commit over moving branch and ref', () => {
      expect(
        getPluginComponentFileUrl(
          { source: 'github', repo: 'external/plugin', commit: 'abcdef12', branch: 'main', ref: 'develop' },
          marketplaceRepo,
          defaultBranch,
          'commands/run.md'
        )
      ).toBe('https://github.com/external/plugin/blob/abcdef12/commands/run.md')
    })
  })

  describe('git-subdir object sources', () => {
    it('resolves git-subdir with specified path', () => {
      expect(
        getPluginComponentFileUrl(
          { source: 'git-subdir', url: 'https://github.com/external/monorepo', path: 'plugins/core', ref: 'develop' },
          marketplaceRepo,
          defaultBranch,
          'agents/helper.md'
        )
      ).toBe('https://github.com/external/monorepo/blob/develop/plugins/core/agents/helper.md')
    })

    it('resolves www.github.com URLs and canonicalizes the component link host', () => {
      expect(
        getPluginComponentFileUrl(
          { source: 'git-subdir', url: 'https://www.github.com/external/monorepo.git', path: 'plugins/core' },
          marketplaceRepo,
          defaultBranch,
          'agents/helper.md'
        )
      ).toBe('https://github.com/external/monorepo/blob/HEAD/plugins/core/agents/helper.md')
    })

    it('rejects lookalike GitHub hostnames', () => {
      expect(
        getPluginComponentFileUrl(
          { source: 'git-subdir', url: 'https://www.github.com.evil.test/external/monorepo', path: 'plugins/core' },
          marketplaceRepo,
          defaultBranch,
          'agents/helper.md'
        )
      ).toBeNull()
    })

    it('returns null if path is omitted in git-subdir', () => {
      expect(
        getPluginComponentFileUrl(
          { source: 'git-subdir', url: 'https://github.com/external/monorepo' },
          marketplaceRepo,
          defaultBranch,
          'agents/helper.md'
        )
      ).toBeNull()
    })
  })

  describe('security and validation', () => {
    it('rejects path traversal in file', () => {
      expect(getPluginComponentFileUrl('.', marketplaceRepo, defaultBranch, '../secret.txt')).toBeNull()
      expect(getPluginComponentFileUrl('.', marketplaceRepo, defaultBranch, 'a/../../secret.txt')).toBeNull()
    })

    it('rejects path traversal in plugin root', () => {
      expect(getPluginComponentFileUrl('./../escape', marketplaceRepo, defaultBranch, 'file.md')).toBeNull()
    })

    it('rejects absolute paths and backslashes', () => {
      expect(getPluginComponentFileUrl('.', marketplaceRepo, defaultBranch, '/root/file.md')).toBeNull()
      expect(getPluginComponentFileUrl('.', marketplaceRepo, defaultBranch, 'sub\\file.md')).toBeNull()
    })

    it('rejects ambiguous empty and dot segments in source and component paths', () => {
      expect(getPluginComponentFileUrl('.', marketplaceRepo, defaultBranch, 'commands//run.md')).toBeNull()
      expect(getPluginComponentFileUrl('.', marketplaceRepo, defaultBranch, 'commands/./run.md')).toBeNull()
      expect(getPluginComponentFileUrl('./plugins//core', marketplaceRepo, defaultBranch, 'commands/run.md')).toBeNull()
      expect(getPluginComponentFileUrl('./plugins/./core', marketplaceRepo, defaultBranch, 'commands/run.md')).toBeNull()
    })

    it('rejects newlines in paths', () => {
      expect(getPluginComponentFileUrl('.', marketplaceRepo, defaultBranch, 'sub/\nfile.md')).toBeNull()
    })

    it('returns null for undefined or unsupported sources', () => {
      expect(getPluginComponentFileUrl(undefined, marketplaceRepo, defaultBranch, 'file.md')).toBeNull()
      expect(getPluginComponentFileUrl('npm:package', marketplaceRepo, defaultBranch, 'file.md')).toBeNull()
      expect(
        getPluginComponentFileUrl({ source: 'unknown' as string, repo: 'owner/repo' }, marketplaceRepo, defaultBranch, 'file.md')
      ).toBeNull()
    })

    it('returns null for non-github URLs', () => {
      expect(
        getPluginComponentFileUrl(
          { source: 'github', url: 'https://gitlab.com/external/plugin' },
          marketplaceRepo,
          defaultBranch,
          'file.md'
        )
      ).toBeNull()
    })
  })
})
