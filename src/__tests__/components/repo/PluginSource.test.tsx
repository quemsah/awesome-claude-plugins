import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PluginSource } from '../../../components/repo/PluginSource'

describe('PluginSource', () => {
  describe('rendering', () => {
    it('should render source link with full path', () => {
      render(<PluginSource source="src/plugin.ts" repoPath="owner/repo" defaultBranch="main" />)

      expect(screen.getByText('Source')).toBeInTheDocument()
      const link = screen.getByText('src/plugin.ts')
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/blob/main/src/plugin.ts')
    })

    it('should not render when source is undefined', () => {
      const { container } = render(<PluginSource source={undefined} repoPath="owner/repo" defaultBranch="main" />)
      expect(container.firstChild).toBeNull()
    })

    it('should not render when source is empty string', () => {
      const { container } = render(<PluginSource source="" repoPath="owner/repo" defaultBranch="main" />)
      expect(container.firstChild).toBeNull()
    })

    it('should handle custom default branch', () => {
      render(<PluginSource source="index.ts" repoPath="owner/repo" defaultBranch="develop" />)

      const link = screen.getByText('index.ts')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/blob/develop/index.ts')
    })

    it('should handle undefined default branch', () => {
      render(<PluginSource source="index.ts" repoPath="owner/repo" defaultBranch={undefined} />)

      const link = screen.getByText('index.ts')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/blob/undefined/index.ts')
    })
  })

  describe('link attributes', () => {
    it('should have correct link attributes', () => {
      render(<PluginSource source="src/main.ts" repoPath="owner/repo" defaultBranch="main" />)

      const link = screen.getByText('src/main.ts')
      expect(link.tagName).toBe('A')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('should apply correct CSS classes to link', () => {
      render(<PluginSource source="file.ts" repoPath="owner/repo" defaultBranch="main" />)

      const link = screen.getByText('file.ts')
      expect(link).toHaveClass(
        'hover:text-primary',
        'hover:underline',
        'underline-offset-4',
        'transition-colors',
        'group-hover:text-primary'
      )
    })

    it('should apply break-all class to paragraph', () => {
      render(<PluginSource source="file.ts" repoPath="owner/repo" defaultBranch="main" />)

      const paragraph = screen.getByText('file.ts').closest('p')
      expect(paragraph).toHaveClass('text-muted-foreground', 'text-sm', 'break-all')
    })
  })

  describe('URL construction', () => {
    it('should handle source with nested path', () => {
      render(<PluginSource source="deep/nested/path/file.ts" repoPath="owner/repo" defaultBranch="main" />)

      const link = screen.getByText('deep/nested/path/file.ts')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/blob/main/deep/nested/path/file.ts')
    })

    it('should handle source starting with slash', () => {
      render(<PluginSource source="/src/index.ts" repoPath="owner/repo" defaultBranch="main" />)

      const link = screen.getByText('/src/index.ts')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/blob/main//src/index.ts')
    })

    it('should handle source with special characters', () => {
      render(<PluginSource source="src/file-name_v2.ts" repoPath="owner/repo" defaultBranch="main" />)

      const link = screen.getByText('src/file-name_v2.ts')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/blob/main/src/file-name_v2.ts')
    })

    it('should handle repoPath with organization and dashes', () => {
      render(<PluginSource source="index.ts" repoPath="my-org/my-repo" defaultBranch="main" />)

      const link = screen.getByText('index.ts')
      expect(link).toHaveAttribute('href', 'https://github.com/my-org/my-repo/blob/main/index.ts')
    })

    it('should handle branch with slashes', () => {
      render(<PluginSource source="file.ts" repoPath="owner/repo" defaultBranch="feature/new-branch" />)

      const link = screen.getByText('file.ts')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/blob/feature/new-branch/file.ts')
    })
  })

  describe('edge cases', () => {
    it('should handle very long source path', () => {
      const longPath = 'src/' + 'a'.repeat(200) + '/file.ts'
      render(<PluginSource source={longPath} repoPath="owner/repo" defaultBranch="main" />)

      expect(screen.getByText(longPath)).toBeInTheDocument()
    })

    it('should handle source with spaces', () => {
      render(<PluginSource source="src/file name.ts" repoPath="owner/repo" defaultBranch="main" />)

      const link = screen.getByText('src/file name.ts')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/blob/main/src/file name.ts')
    })

    it('should handle source with query parameters', () => {
      render(<PluginSource source="file.ts?param=value" repoPath="owner/repo" defaultBranch="main" />)

      const link = screen.getByText('file.ts?param=value')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/blob/main/file.ts?param=value')
    })

    it('should handle source with hash', () => {
      render(<PluginSource source="file.ts#L10" repoPath="owner/repo" defaultBranch="main" />)

      const link = screen.getByText('file.ts#L10')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/blob/main/file.ts#L10')
    })

    it('should handle unicode in source path', () => {
      render(<PluginSource source="src/文件.ts" repoPath="owner/repo" defaultBranch="main" />)

      const link = screen.getByText('src/文件.ts')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/blob/main/src/文件.ts')
    })

    it('should handle whitespace-only source', () => {
      render(<PluginSource source="   " repoPath="owner/repo" defaultBranch="main" />)

      const link = screen.getByText('   ')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/blob/main/   ')
    })
  })

  describe('styling', () => {
    it('should apply correct CSS classes to heading', () => {
      render(<PluginSource source="file.ts" repoPath="owner/repo" defaultBranch="main" />)

      const heading = screen.getByText('Source')
      expect(heading.tagName).toBe('H3')
      expect(heading).toHaveClass('font-medium', 'text-sm', 'mb-0.5')
    })
  })
})