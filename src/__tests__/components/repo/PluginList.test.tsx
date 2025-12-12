import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PluginList } from '../../../components/repo/PluginList'

describe('PluginList', () => {
  describe('rendering', () => {
    it('should render list of items with links', () => {
      const items = ['cmd/main.go', 'cmd/helper.go']
      render(<PluginList title="Commands" items={items} repoPath="owner/repo" defaultBranch="main" />)

      expect(screen.getByText('Commands (2)')).toBeInTheDocument()
      expect(screen.getByText('cmd/main.go')).toBeInTheDocument()
      expect(screen.getByText('cmd/helper.go')).toBeInTheDocument()
    })

    it('should render correct URLs for items', () => {
      const items = ['file1.ts', 'file2.ts']
      render(<PluginList title="Files" items={items} repoPath="owner/repo" defaultBranch="main" />)

      const link1 = screen.getByText('file1.ts')
      const link2 = screen.getByText('file2.ts')

      expect(link1).toHaveAttribute('href', 'https://github.com/owner/repo/blob/main/file1.ts')
      expect(link2).toHaveAttribute('href', 'https://github.com/owner/repo/blob/main/file2.ts')
    })

    it('should not render when items is undefined', () => {
      const { container } = render(<PluginList title="Commands" items={undefined} repoPath="owner/repo" defaultBranch="main" />)
      expect(container.firstChild).toBeNull()
    })

    it('should not render when items is empty array', () => {
      const { container } = render(<PluginList title="Commands" items={[]} repoPath="owner/repo" defaultBranch="main" />)
      expect(container.firstChild).toBeNull()
    })

    it('should render single item', () => {
      render(<PluginList title="Commands" items={['single.ts']} repoPath="owner/repo" defaultBranch="main" />)

      expect(screen.getByText('Commands (1)')).toBeInTheDocument()
      expect(screen.getByText('single.ts')).toBeInTheDocument()
    })
  })

  describe('title with count', () => {
    it('should show correct count in title', () => {
      render(<PluginList title="Agents" items={['a', 'b', 'c', 'd', 'e']} repoPath="owner/repo" defaultBranch="main" />)

      expect(screen.getByText('Agents (5)')).toBeInTheDocument()
    })

    it('should update count when items change', () => {
      const { rerender } = render(<PluginList title="Files" items={['a', 'b']} repoPath="owner/repo" defaultBranch="main" />)

      expect(screen.getByText('Files (2)')).toBeInTheDocument()

      rerender(<PluginList title="Files" items={['a', 'b', 'c']} repoPath="owner/repo" defaultBranch="main" />)

      expect(screen.getByText('Files (3)')).toBeInTheDocument()
    })
  })

  describe('link attributes', () => {
    it('should have correct link attributes', () => {
      render(<PluginList title="Commands" items={['cmd.ts']} repoPath="owner/repo" defaultBranch="main" />)

      const link = screen.getByText('cmd.ts')
      expect(link.tagName).toBe('A')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('should apply correct CSS classes to links', () => {
      render(<PluginList title="Commands" items={['cmd.ts']} repoPath="owner/repo" defaultBranch="main" />)

      const link = screen.getByText('cmd.ts')
      expect(link).toHaveClass(
        'hover:text-primary',
        'hover:underline',
        'underline-offset-4',
        'transition-colors',
        'group-hover:text-primary'
      )
    })
  })

  describe('different branches', () => {
    it('should use custom default branch', () => {
      render(<PluginList title="Files" items={['file.ts']} repoPath="owner/repo" defaultBranch="develop" />)

      const link = screen.getByText('file.ts')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/blob/develop/file.ts')
    })

    it('should handle undefined branch', () => {
      render(<PluginList title="Files" items={['file.ts']} repoPath="owner/repo" defaultBranch={undefined} />)

      const link = screen.getByText('file.ts')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/blob/undefined/file.ts')
    })

    it('should handle branch with slashes', () => {
      render(<PluginList title="Files" items={['file.ts']} repoPath="owner/repo" defaultBranch="feature/branch" />)

      const link = screen.getByText('file.ts')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/blob/feature/branch/file.ts')
    })
  })

  describe('edge cases', () => {
    it('should handle very long file paths', () => {
      const longPath = 'very/long/path/to/file/' + 'a'.repeat(100) + '.ts'
      render(<PluginList title="Files" items={[longPath]} repoPath="owner/repo" defaultBranch="main" />)

      expect(screen.getByText(longPath)).toBeInTheDocument()
    })

    it('should handle many items', () => {
      const manyItems = Array.from({ length: 100 }, (_, i) => `file${i}.ts`)
      render(<PluginList title="Files" items={manyItems} repoPath="owner/repo" defaultBranch="main" />)

      expect(screen.getByText('Files (100)')).toBeInTheDocument()
      manyItems.forEach(item => {
        expect(screen.getByText(item)).toBeInTheDocument()
      })
    })

    it('should handle items with special characters', () => {
      const items = ['file-name.ts', 'file_name.ts', 'file@v2.ts']
      render(<PluginList title="Files" items={items} repoPath="owner/repo" defaultBranch="main" />)

      items.forEach(item => {
        expect(screen.getByText(item)).toBeInTheDocument()
      })
    })

    it('should handle items with spaces', () => {
      const items = ['file name.ts', 'another file.ts']
      render(<PluginList title="Files" items={items} repoPath="owner/repo" defaultBranch="main" />)

      items.forEach(item => {
        const link = screen.getByText(item)
        expect(link).toBeInTheDocument()
      })
    })

    it('should handle items with unicode', () => {
      const items = ['文件.ts', 'ملف.ts', '🚀file.ts']
      render(<PluginList title="Files" items={items} repoPath="owner/repo" defaultBranch="main" />)

      items.forEach(item => {
        expect(screen.getByText(item)).toBeInTheDocument()
      })
    })

    it('should handle duplicate items', () => {
      const items = ['file.ts', 'file.ts', 'file.ts']
      render(<PluginList title="Files" items={items} repoPath="owner/repo" defaultBranch="main" />)

      expect(screen.getByText('Files (3)')).toBeInTheDocument()
      // Since key is based on item value, duplicates might cause issues
      // but component should still render
      const links = screen.getAllByText('file.ts')
      expect(links.length).toBeGreaterThan(0)
    })

    it('should handle empty string items', () => {
      const items = ['', 'valid.ts', '']
      render(<PluginList title="Files" items={items} repoPath="owner/repo" defaultBranch="main" />)

      expect(screen.getByText('Files (3)')).toBeInTheDocument()
      expect(screen.getByText('valid.ts')).toBeInTheDocument()
    })
  })

  describe('styling', () => {
    it('should apply correct CSS classes to heading', () => {
      render(<PluginList title="Commands" items={['cmd.ts']} repoPath="owner/repo" defaultBranch="main" />)

      const heading = screen.getByText('Commands (1)')
      expect(heading.tagName).toBe('H3')
      expect(heading).toHaveClass('font-medium', 'text-sm', 'mb-0.5')
    })

    it('should apply correct classes to list', () => {
      const { container } = render(<PluginList title="Commands" items={['cmd.ts']} repoPath="owner/repo" defaultBranch="main" />)

      const list = container.querySelector('ul')
      expect(list).toHaveClass('text-muted-foreground', 'text-sm', 'list-disc', 'list-inside', 'space-y-0.5')
    })

    it('should apply break-all to list items', () => {
      render(<PluginList title="Commands" items={['very-long-file-name.ts']} repoPath="owner/repo" defaultBranch="main" />)

      const listItem = screen.getByText('very-long-file-name.ts').closest('li')
      expect(listItem).toHaveClass('break-all')
    })
  })
})