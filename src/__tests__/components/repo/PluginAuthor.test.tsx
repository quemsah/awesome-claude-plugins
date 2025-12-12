import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PluginAuthor } from '../../../components/repo/PluginAuthor'

describe('PluginAuthor', () => {
  describe('rendering', () => {
    it('should render author name and email', () => {
      const author = { name: 'John Doe', email: 'john@example.com' }
      render(<PluginAuthor author={author} />)

      expect(screen.getByText('Author')).toBeInTheDocument()
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText(/\(john@example\.com\)/)).toBeInTheDocument()
    })

    it('should render only author name when email is missing', () => {
      const author = { name: 'Jane Smith' }
      render(<PluginAuthor author={author} />)

      expect(screen.getByText('Author')).toBeInTheDocument()
      expect(screen.getByText('Jane Smith')).toBeInTheDocument()
      expect(screen.queryByText(/@/)).not.toBeInTheDocument()
    })

    it('should render only email when name is missing', () => {
      const author = { email: 'anonymous@example.com' }
      render(<PluginAuthor author={author} />)

      expect(screen.getByText('Author')).toBeInTheDocument()
      expect(screen.getByText('anonymous@example.com')).toBeInTheDocument()
    })

    it('should not render when author is undefined', () => {
      const { container } = render(<PluginAuthor author={undefined} />)
      expect(container.firstChild).toBeNull()
    })

    it('should not render when author is null', () => {
      const { container } = render(<PluginAuthor author={null as any} />)
      expect(container.firstChild).toBeNull()
    })

    it('should not render when author object is empty', () => {
      const author = {}
      const { container } = render(<PluginAuthor author={author} />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('styling and structure', () => {
    it('should apply correct CSS classes', () => {
      const author = { name: 'John Doe', email: 'john@example.com' }
      const { container } = render(<PluginAuthor author={author} />)

      const heading = screen.getByText('Author')
      expect(heading.tagName).toBe('H3')
      expect(heading).toHaveClass('font-medium', 'text-sm', 'mb-0.5')
    })

    it('should render name with medium font weight', () => {
      const author = { name: 'John Doe', email: 'john@example.com' }
      render(<PluginAuthor author={author} />)

      const nameElement = screen.getByText('John Doe').closest('p')
      expect(nameElement).toHaveClass('font-medium')
    })

    it('should have break-all class for email only display', () => {
      const author = { email: 'verylongemail@example.com' }
      render(<PluginAuthor author={author} />)

      const emailElement = screen.getByText('verylongemail@example.com').closest('p')
      expect(emailElement).toHaveClass('break-all')
    })
  })

  describe('edge cases', () => {
    it('should handle very long author name', () => {
      const author = { name: 'A'.repeat(200) }
      render(<PluginAuthor author={author} />)

      expect(screen.getByText('A'.repeat(200))).toBeInTheDocument()
    })

    it('should handle very long email', () => {
      const author = { email: 'a'.repeat(100) + '@' + 'b'.repeat(100) + '.com' }
      render(<PluginAuthor author={author} />)

      expect(screen.getByText(author.email)).toBeInTheDocument()
    })

    it('should handle special characters in name', () => {
      const author = { name: 'John O\'Brien-Müller' }
      render(<PluginAuthor author={author} />)

      expect(screen.getByText('John O\'Brien-Müller')).toBeInTheDocument()
    })

    it('should handle special characters in email', () => {
      const author = { email: 'user+tag@sub.example.com' }
      render(<PluginAuthor author={author} />)

      expect(screen.getByText('user+tag@sub.example.com')).toBeInTheDocument()
    })

    it('should handle empty string name', () => {
      const author = { name: '', email: 'test@example.com' }
      render(<PluginAuthor author={author} />)

      expect(screen.getByText('test@example.com')).toBeInTheDocument()
      expect(screen.queryByText(/^\s*$/)).not.toBeInTheDocument()
    })

    it('should handle empty string email', () => {
      const author = { name: 'John Doe', email: '' }
      render(<PluginAuthor author={author} />)

      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.queryByText(/^\(\s*\)$/)).not.toBeInTheDocument()
    })

    it('should handle whitespace-only name', () => {
      const author = { name: '   ', email: 'test@example.com' }
      render(<PluginAuthor author={author} />)

      expect(screen.getByText('test@example.com')).toBeInTheDocument()
    })
  })
})