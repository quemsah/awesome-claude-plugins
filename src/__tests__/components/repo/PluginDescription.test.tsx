import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PluginDescription } from '../../../components/repo/PluginDescription'

describe('PluginDescription', () => {
  describe('rendering', () => {
    it('should render description text', () => {
      render(<PluginDescription description="This is a test plugin" />)

      expect(screen.getByText('Description')).toBeInTheDocument()
      expect(screen.getByText('This is a test plugin')).toBeInTheDocument()
    })

    it('should not render when description is undefined', () => {
      const { container } = render(<PluginDescription description={undefined} />)
      expect(container.firstChild).toBeNull()
    })

    it('should not render when description is empty string', () => {
      const { container } = render(<PluginDescription description="" />)
      expect(container.firstChild).toBeNull()
    })

    it('should render multi-line description', () => {
      const description = 'Line 1\nLine 2\nLine 3'
      render(<PluginDescription description={description} />)

      expect(screen.getByText(description)).toBeInTheDocument()
    })
  })

  describe('styling', () => {
    it('should apply correct CSS classes to heading', () => {
      render(<PluginDescription description="Test" />)

      const heading = screen.getByText('Description')
      expect(heading.tagName).toBe('H3')
      expect(heading).toHaveClass('font-medium', 'text-sm', 'mb-0.5')
    })

    it('should apply muted foreground and transition classes to paragraph', () => {
      render(<PluginDescription description="Test description" />)

      const paragraph = screen.getByText('Test description')
      expect(paragraph.tagName).toBe('P')
      expect(paragraph).toHaveClass('text-muted-foreground', 'text-sm', 'opacity-90', 'group-hover:opacity-100', 'transition-opacity', 'duration-300')
    })
  })

  describe('edge cases', () => {
    it('should handle very long description', () => {
      const longDescription = 'A'.repeat(1000)
      render(<PluginDescription description={longDescription} />)

      expect(screen.getByText(longDescription)).toBeInTheDocument()
    })

    it('should handle description with HTML special characters', () => {
      const description = '<script>alert("test")</script> & " \' <>'
      render(<PluginDescription description={description} />)

      expect(screen.getByText(description)).toBeInTheDocument()
    })

    it('should handle description with markdown-like syntax', () => {
      const description = '# Heading\n**bold** *italic* [link](url)'
      render(<PluginDescription description={description} />)

      expect(screen.getByText(description)).toBeInTheDocument()
    })

    it('should handle whitespace-only description', () => {
      const { container } = render(<PluginDescription description="   " />)
      expect(container.firstChild).not.toBeNull()
      expect(screen.getByText('   ')).toBeInTheDocument()
    })

    it('should handle description with unicode characters', () => {
      const description = '🚀 Plugin with emojis 中文 العربية'
      render(<PluginDescription description={description} />)

      expect(screen.getByText(description)).toBeInTheDocument()
    })

    it('should handle description with URLs', () => {
      const description = 'Check out https://example.com for more info'
      render(<PluginDescription description={description} />)

      expect(screen.getByText(description)).toBeInTheDocument()
    })
  })
})