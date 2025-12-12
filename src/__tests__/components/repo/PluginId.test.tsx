import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PluginId } from '../../../components/repo/PluginId'

describe('PluginId', () => {
  describe('rendering', () => {
    it('should render plugin id', () => {
      render(<PluginId id="plugin-123" />)

      expect(screen.getByText('Plugin ID')).toBeInTheDocument()
      expect(screen.getByText('plugin-123')).toBeInTheDocument()
    })

    it('should not render when id is undefined', () => {
      const { container } = render(<PluginId id={undefined} />)
      expect(container.firstChild).toBeNull()
    })

    it('should not render when id is empty string', () => {
      const { container } = render(<PluginId id="" />)
      expect(container.firstChild).toBeNull()
    })

    it('should render id with special characters', () => {
      render(<PluginId id="plugin@v1.0.0-beta" />)

      expect(screen.getByText('plugin@v1.0.0-beta')).toBeInTheDocument()
    })
  })

  describe('styling', () => {
    it('should apply correct CSS classes to heading', () => {
      render(<PluginId id="test-id" />)

      const heading = screen.getByText('Plugin ID')
      expect(heading.tagName).toBe('H3')
      expect(heading).toHaveClass('font-medium', 'text-sm', 'mb-0.5')
    })

    it('should apply break-all class to paragraph', () => {
      render(<PluginId id="very-long-plugin-id-without-breaks" />)

      const paragraph = screen.getByText('very-long-plugin-id-without-breaks')
      expect(paragraph.tagName).toBe('P')
      expect(paragraph).toHaveClass('text-muted-foreground', 'text-sm', 'break-all')
    })
  })

  describe('edge cases', () => {
    it('should handle very long id', () => {
      const longId = 'plugin-' + 'a'.repeat(500)
      render(<PluginId id={longId} />)

      expect(screen.getByText(longId)).toBeInTheDocument()
    })

    it('should handle id with slashes', () => {
      render(<PluginId id="namespace/plugin/version" />)

      expect(screen.getByText('namespace/plugin/version')).toBeInTheDocument()
    })

    it('should handle id with unicode', () => {
      render(<PluginId id="plugin-中文-🚀" />)

      expect(screen.getByText('plugin-中文-🚀')).toBeInTheDocument()
    })

    it('should handle id with URLs', () => {
      render(<PluginId id="https://example.com/plugins/test" />)

      expect(screen.getByText('https://example.com/plugins/test')).toBeInTheDocument()
    })

    it('should handle whitespace-only id', () => {
      render(<PluginId id="   " />)

      expect(screen.getByText('   ')).toBeInTheDocument()
    })

    it('should handle id with newlines', () => {
      const id = 'line1\nline2\nline3'
      render(<PluginId id={id} />)

      expect(screen.getByText(id)).toBeInTheDocument()
    })
  })
})