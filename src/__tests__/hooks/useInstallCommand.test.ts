import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useInstallCommand } from '../../hooks/useInstallCommand'

describe('useInstallCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('getInstallCommand', () => {
    it('should generate command with plugin name only', () => {
      const { result } = renderHook(() => useInstallCommand('My Plugin', undefined, undefined))
      expect(result.current.getInstallCommand()).toBe('/plugin install my-plugin')
    })

    it('should normalize plugin name by lowercasing', () => {
      const { result } = renderHook(() => useInstallCommand('UPPERCASE Plugin', undefined, undefined))
      expect(result.current.getInstallCommand()).toBe('/plugin install uppercase-plugin')
    })

    it('should replace spaces with hyphens in plugin name', () => {
      const { result } = renderHook(() => useInstallCommand('Multi Word Plugin Name', undefined, undefined))
      expect(result.current.getInstallCommand()).toBe('/plugin install multi-word-plugin-name')
    })

    it('should handle multiple consecutive spaces', () => {
      const { result } = renderHook(() => useInstallCommand('Plugin   With    Spaces', undefined, undefined))
      expect(result.current.getInstallCommand()).toBe('/plugin install plugin-with-spaces')
    })

    it('should append plugin id when provided', () => {
      const { result } = renderHook(() => useInstallCommand('My Plugin', 'plugin-123', undefined))
      expect(result.current.getInstallCommand()).toBe('/plugin install my-plugin@plugin-123')
    })

    it('should append repoPath when provided and no plugin id', () => {
      const { result } = renderHook(() => useInstallCommand('My Plugin', undefined, 'owner/repo'))
      expect(result.current.getInstallCommand()).toBe('/plugin install my-plugin@owner-repo')
    })

    it('should replace forward slash with hyphen in repoPath', () => {
      const { result } = renderHook(() => useInstallCommand('My Plugin', undefined, 'github-user/my-repo'))
      expect(result.current.getInstallCommand()).toBe('/plugin install my-plugin@github-user-my-repo')
    })

    it('should prefer plugin id over repoPath when both provided', () => {
      const { result } = renderHook(() => useInstallCommand('My Plugin', 'plugin-123', 'owner/repo'))
      expect(result.current.getInstallCommand()).toBe('/plugin install my-plugin@plugin-123')
    })

    it('should handle empty plugin name', () => {
      const { result } = renderHook(() => useInstallCommand('', undefined, undefined))
      expect(result.current.getInstallCommand()).toBe('/plugin install ')
    })

    it('should handle undefined plugin name', () => {
      const { result } = renderHook(() => useInstallCommand(undefined, undefined, undefined))
      expect(result.current.getInstallCommand()).toBe('/plugin install ')
    })

    it('should handle special characters in plugin name', () => {
      const { result } = renderHook(() => useInstallCommand('Plugin@Name!', undefined, undefined))
      expect(result.current.getInstallCommand()).toBe('/plugin install plugin@name!')
    })

    it('should handle leading and trailing spaces', () => {
      const { result } = renderHook(() => useInstallCommand('  Plugin Name  ', undefined, undefined))
      expect(result.current.getInstallCommand()).toBe('/plugin install plugin-name')
    })
  })

  describe('handleCopyClick', () => {
    it('should copy command to clipboard', async () => {
      const { result } = renderHook(() => useInstallCommand('My Plugin', undefined, undefined))
      
      await act(async () => {
        result.current.handleCopyClick()
      })

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/plugin install my-plugin')
    })

    it('should set isCopied to true after copying', async () => {
      const { result } = renderHook(() => useInstallCommand('My Plugin', undefined, undefined))
      
      expect(result.current.isCopied).toBe(false)
      
      await act(async () => {
        result.current.handleCopyClick()
      })

      expect(result.current.isCopied).toBe(true)
    })

    it('should reset isCopied to false after 500ms', async () => {
      const { result } = renderHook(() => useInstallCommand('My Plugin', undefined, undefined))
      
      await act(async () => {
        result.current.handleCopyClick()
      })

      expect(result.current.isCopied).toBe(true)

      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(result.current.isCopied).toBe(false)
    })

    it('should not reset isCopied before 500ms', async () => {
      const { result } = renderHook(() => useInstallCommand('My Plugin', undefined, undefined))
      
      await act(async () => {
        result.current.handleCopyClick()
      })

      expect(result.current.isCopied).toBe(true)

      act(() => {
        vi.advanceTimersByTime(400)
      })

      expect(result.current.isCopied).toBe(true)
    })

    it('should handle multiple rapid clicks correctly', async () => {
      const { result } = renderHook(() => useInstallCommand('My Plugin', undefined, undefined))
      
      await act(async () => {
        result.current.handleCopyClick()
      })

      expect(result.current.isCopied).toBe(true)

      act(() => {
        vi.advanceTimersByTime(200)
      })

      await act(async () => {
        result.current.handleCopyClick()
      })

      expect(result.current.isCopied).toBe(true)
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2)
    })
  })

  describe('state management', () => {
    it('should maintain independent state across multiple hook instances', async () => {
      const { result: result1 } = renderHook(() => useInstallCommand('Plugin 1', undefined, undefined))
      const { result: result2 } = renderHook(() => useInstallCommand('Plugin 2', undefined, undefined))
      
      await act(async () => {
        result1.current.handleCopyClick()
      })

      expect(result1.current.isCopied).toBe(true)
      expect(result2.current.isCopied).toBe(false)
    })
  })
})