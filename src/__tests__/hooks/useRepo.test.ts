import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useRepo } from '../../hooks/useRepo'

describe('useRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(global.fetch as any).mockReset()
  })

  describe('successful repository fetch', () => {
    it('should fetch and set repository data', async () => {
      const mockRepo = {
        id: 123,
        name: 'test-repo',
        owner: { login: 'test-owner', avatar_url: 'https://example.com/avatar.png' },
        description: 'Test repository',
        stargazers_count: 100,
        forks_count: 50,
        default_branch: 'main',
      }

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockRepo,
      })

      const { result } = renderHook(() => useRepo('test-owner/test-repo'))

      expect(result.current.loading).toBe(true)
      expect(result.current.repo).toBeNull()
      expect(result.current.error).toBeNull()

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.repo).toEqual(mockRepo)
      expect(result.current.error).toBeNull()
      expect(global.fetch).toHaveBeenCalledWith('https://api.github.com/repos/test-owner/test-repo')
    })

    it('should handle repository with minimal data', async () => {
      const mockRepo = {
        id: 456,
        name: 'minimal-repo',
        owner: { login: 'minimal-owner' },
      }

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockRepo,
      })

      const { result } = renderHook(() => useRepo('minimal-owner/minimal-repo'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.repo).toEqual(mockRepo)
      expect(result.current.error).toBeNull()
    })

    it('should handle repository with special characters in path', async () => {
      const mockRepo = {
        id: 789,
        name: 'repo-with-dashes',
        owner: { login: 'user-with-dashes' },
      }

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockRepo,
      })

      const { result } = renderHook(() => useRepo('user-with-dashes/repo-with-dashes'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.repo).toEqual(mockRepo)
      expect(global.fetch).toHaveBeenCalledWith('https://api.github.com/repos/user-with-dashes/repo-with-dashes')
    })
  })

  describe('error handling', () => {
    it('should handle 404 not found error', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      const { result } = renderHook(() => useRepo('nonexistent/repo'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.repo).toBeNull()
      expect(result.current.error).toBe('Repository not found')
    })

    it('should handle other HTTP errors', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      const { result } = renderHook(() => useRepo('test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.repo).toBeNull()
      expect(result.current.error).toBe('Failed to load repository')
    })

    it('should handle 403 forbidden error', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 403,
      })

      const { result } = renderHook(() => useRepo('test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.repo).toBeNull()
      expect(result.current.error).toBe('Failed to load repository')
    })

    it('should handle network errors', async () => {
      ;(global.fetch as any).mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useRepo('test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.repo).toBeNull()
      expect(result.current.error).toBe('Failed to load repository')
    })

    it('should handle fetch throwing an exception', async () => {
      ;(global.fetch as any).mockImplementationOnce(() => {
        throw new Error('Unexpected error')
      })

      const { result } = renderHook(() => useRepo('test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.repo).toBeNull()
      expect(result.current.error).toBe('Failed to load repository')
    })

    it('should handle JSON parsing errors', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON')
        },
      })

      const { result } = renderHook(() => useRepo('test-owner/test-repo'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.repo).toBeNull()
      expect(result.current.error).toBe('Failed to load repository')
    })
  })

  describe('repoPath changes', () => {
    it('should refetch when repoPath changes', async () => {
      const mockRepo1 = { id: 1, name: 'repo1', owner: { login: 'owner1' } }
      const mockRepo2 = { id: 2, name: 'repo2', owner: { login: 'owner2' } }

      ;(global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockRepo1,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockRepo2,
        })

      const { result, rerender } = renderHook(
        ({ path }) => useRepo(path),
        { initialProps: { path: 'owner1/repo1' } }
      )

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.repo).toEqual(mockRepo1)

      rerender({ path: 'owner2/repo2' })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.repo).toEqual(mockRepo2)
      expect(global.fetch).toHaveBeenCalledTimes(2)
      expect(global.fetch).toHaveBeenNthCalledWith(1, 'https://api.github.com/repos/owner1/repo1')
      expect(global.fetch).toHaveBeenNthCalledWith(2, 'https://api.github.com/repos/owner2/repo2')
    })

    it('should reset loading state when repoPath changes', async () => {
      const mockRepo = { id: 1, name: 'repo', owner: { login: 'owner' } }

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockRepo,
      })

      const { result, rerender } = renderHook(
        ({ path }) => useRepo(path),
        { initialProps: { path: 'owner1/repo1' } }
      )

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      rerender({ path: 'owner2/repo2' })

      expect(result.current.loading).toBe(true)

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })
    })
  })

  describe('edge cases', () => {
    it('should handle empty repoPath gracefully', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      const { result } = renderHook(() => useRepo(''))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(global.fetch).toHaveBeenCalledWith('https://api.github.com/repos/')
    })

    it('should handle repoPath with trailing slash', async () => {
      const mockRepo = { id: 1, name: 'repo', owner: { login: 'owner' } }

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockRepo,
      })

      const { result } = renderHook(() => useRepo('owner/repo/'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(global.fetch).toHaveBeenCalledWith('https://api.github.com/repos/owner/repo/')
    })

    it('should handle very long repoPath', async () => {
      const longPath = 'a'.repeat(100) + '/' + 'b'.repeat(100)
      const mockRepo = { id: 1, name: 'b'.repeat(100), owner: { login: 'a'.repeat(100) } }

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockRepo,
      })

      const { result } = renderHook(() => useRepo(longPath))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.repo).toEqual(mockRepo)
    })
  })
})