import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePlugins } from '../../hooks/usePlugins'

describe('usePlugins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(global.fetch as any).mockReset()
  })

  const mockRepo = {
    id: 123,
    name: 'test-repo',
    owner: { login: 'test-owner' },
    default_branch: 'main',
  }

  describe('successful plugin fetch', () => {
    it('should fetch and set plugins from array structure', async () => {
      const mockPlugins = [
        { name: 'plugin1', version: '1.0.0', id: 'p1' },
        { name: 'plugin2', version: '2.0.0', id: 'p2' },
      ]

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPlugins,
      })

      const { result } = renderHook(() => usePlugins(mockRepo as any, 'test-owner/test-repo'))

      expect(result.current.pluginsLoading).toBe(true)

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual(mockPlugins)
      expect(result.current.pluginsError).toBeNull()
      expect(global.fetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/test-owner/test-repo/main/.claude-plugin/marketplace.json'
      )
    })

    it('should fetch and set plugins from object with plugins property', async () => {
      const mockPlugins = [
        { name: 'plugin1', version: '1.0.0' },
        { name: 'plugin2', version: '2.0.0' },
      ]

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: mockPlugins }),
      })

      const { result } = renderHook(() => usePlugins(mockRepo as any, 'test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual(mockPlugins)
      expect(result.current.pluginsError).toBeNull()
    })

    it('should handle empty plugins array', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })

      const { result } = renderHook(() => usePlugins(mockRepo as any, 'test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual([])
      expect(result.current.pluginsError).toBeNull()
    })

    it('should handle plugin with all optional fields', async () => {
      const mockPlugin = {
        name: 'full-plugin',
        description: 'A comprehensive plugin',
        version: '1.0.0',
        id: 'full-plugin-id',
        source: 'src/plugin.ts',
        category: 'utility',
        author: { name: 'John Doe', email: 'john@example.com' },
        license: 'MIT',
        keywords: ['test', 'plugin'],
        strict: true,
        commands: ['cmd1', 'cmd2'],
        agents: ['agent1'],
        mcpServers: ['server1'],
      }

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [mockPlugin],
      })

      const { result } = renderHook(() => usePlugins(mockRepo as any, 'test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual([mockPlugin])
    })

    it('should use custom default_branch from repo', async () => {
      const customRepo = {
        ...mockRepo,
        default_branch: 'develop',
      }

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })

      const { result } = renderHook(() => usePlugins(customRepo as any, 'test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(global.fetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/test-owner/test-repo/develop/.claude-plugin/marketplace.json'
      )
    })
  })

  describe('error handling', () => {
    it('should handle 404 not found by setting empty plugins', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      const { result } = renderHook(() => usePlugins(mockRepo as any, 'test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual([])
      expect(result.current.pluginsError).toBeNull()
    })

    it('should handle other HTTP errors', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      const { result } = renderHook(() => usePlugins(mockRepo as any, 'test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual([])
      expect(result.current.pluginsError).toBe('Failed to load plugins')
    })

    it('should handle network errors', async () => {
      ;(global.fetch as any).mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => usePlugins(mockRepo as any, 'test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual([])
      expect(result.current.pluginsError).toBe('Failed to load plugins')
    })

    it('should handle invalid JSON structure', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ invalid: 'structure' }),
      })

      const { result } = renderHook(() => usePlugins(mockRepo as any, 'test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual([])
      expect(result.current.pluginsError).toBeNull()
    })

    it('should handle JSON parsing errors', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON')
        },
      })

      const { result } = renderHook(() => usePlugins(mockRepo as any, 'test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual([])
      expect(result.current.pluginsError).toBe('Failed to load plugins')
    })
  })

  describe('null repo handling', () => {
    it('should not fetch when repo is null', async () => {
      const { result } = renderHook(() => usePlugins(null, 'test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual([])
      expect(result.current.pluginsError).toBeNull()
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('should start fetching when repo changes from null to valid', async () => {
      const mockPlugins = [{ name: 'plugin1' }]

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPlugins,
      })

      const { result, rerender } = renderHook(
        ({ repo }) => usePlugins(repo, 'test-owner/test-repo'),
        { initialProps: { repo: null } }
      )

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(global.fetch).not.toHaveBeenCalled()

      rerender({ repo: mockRepo as any })

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual(mockPlugins)
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('dependency changes', () => {
    it('should refetch when repo changes', async () => {
      const mockPlugins1 = [{ name: 'plugin1' }]
      const mockPlugins2 = [{ name: 'plugin2' }]

      const repo1 = { ...mockRepo, id: 1 }
      const repo2 = { ...mockRepo, id: 2 }

      ;(global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPlugins1,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPlugins2,
        })

      const { result, rerender } = renderHook(
        ({ repo }) => usePlugins(repo, 'test-owner/test-repo'),
        { initialProps: { repo: repo1 as any } }
      )

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual(mockPlugins1)

      rerender({ repo: repo2 as any })

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual(mockPlugins2)
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it('should refetch when repoPath changes', async () => {
      const mockPlugins1 = [{ name: 'plugin1' }]
      const mockPlugins2 = [{ name: 'plugin2' }]

      ;(global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPlugins1,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPlugins2,
        })

      const { result, rerender } = renderHook(
        ({ path }) => usePlugins(mockRepo as any, path),
        { initialProps: { path: 'owner1/repo1' } }
      )

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual(mockPlugins1)
      expect(global.fetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/owner1/repo1/main/.claude-plugin/marketplace.json'
      )

      rerender({ path: 'owner2/repo2' })

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual(mockPlugins2)
      expect(global.fetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/owner2/repo2/main/.claude-plugin/marketplace.json'
      )
    })
  })

  describe('edge cases', () => {
    it('should handle plugins with missing optional fields', async () => {
      const mockPlugins = [
        { name: 'minimal-plugin' },
        { id: 'id-only' },
        {},
      ]

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPlugins,
      })

      const { result } = renderHook(() => usePlugins(mockRepo as any, 'test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(result.current.plugins).toEqual(mockPlugins)
    })

    it('should handle very long repoPath', async () => {
      const longPath = 'a'.repeat(100) + '/' + 'b'.repeat(100)

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })

      const { result } = renderHook(() => usePlugins(mockRepo as any, longPath))

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(global.fetch).toHaveBeenCalledWith(
        `https://raw.githubusercontent.com/${longPath}/main/.claude-plugin/marketplace.json`
      )
    })

    it('should handle special characters in repoPath', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })

      const { result } = renderHook(() => usePlugins(mockRepo as any, 'user-name/repo.name'))

      await waitFor(() => {
        expect(result.current.pluginsLoading).toBe(false)
      })

      expect(global.fetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/user-name/repo.name/main/.claude-plugin/marketplace.json'
      )
    })
  })
})