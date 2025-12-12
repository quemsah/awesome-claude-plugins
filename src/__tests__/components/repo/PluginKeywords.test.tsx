import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PluginKeywords } from '../../../components/repo/PluginKeywords'

describe('PluginKeywords', () => {
  describe('rendering', () => {
    it('should render keywords as badges', () => {
      const keywords = ['react', 'typescript', 'testing']
      render(<PluginKeywords keywords={keywords} />)

      expect(screen.getByText('Keywords')).toBeInTheDocument()
      expect(screen.getByText('react')).toBeInTheDocument()
      expect(screen.getByText('typescript')).toBeInTheDocument()
      expect(screen.getByText('testing')).toBeInTheDocument()
    })

    it('should render single keyword', () => {
      render(<PluginKeywords keywords={['single']} />)

      expect(screen.getByText('Keywords')).toBeInTheDocument()
      expect(screen.getByText('single')).toBeInTheDocument()
    })

    it('should not render when keywords is undefined', () => {
      const { container } = render(<PluginKeywords keywords={undefined} />)
      expect(container.firstChild).toBeNull()
    })

    it('should not render when keywords is empty array', () => {
      const { container } = render(<PluginKeywords keywords={[]} />)
      expect(container.firstChild).toBeNull()
    })

    it('should not render when keywords is null', () => {
      const { container } = render(<PluginKeywords keywords={null as any} />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('keyword uniqueness handling', () => {
    it('should render duplicate keywords with unique keys', () => {
      const keywords = ['test', 'test', 'test']
      render(<PluginKeywords keywords={keywords} />)

      const badges = screen.getAllByText('test')
      expect(badges).toHaveLength(3)
    })

    it('should handle mixed unique and duplicate keywords', () => {
      const keywords = ['react', 'test', 'react', 'typescript', 'test']
      render(<PluginKeywords keywords={keywords} />)

      expect(screen.getAllByText('react')).toHaveLength(2)
      expect(screen.getAllByText('test')).toHaveLength(2)
      expect(screen.getByText('typescript')).toBeInTheDocument()
    })
  })

  describe('styling', () => {
    it('should apply correct CSS classes to heading', () => {
      render(<PluginKeywords keywords={['test']} />)

      const heading = screen.getByText('Keywords')
      expect(heading.tagName).toBe('H3')
      expect(heading).toHaveClass('font-medium', 'text-sm', 'mb-0.5')
    })

    it('should apply correct classes to badge wrapper', () => {
      const { container } = render(<PluginKeywords keywords={['test']} />)

      const wrapper = container.querySelector('.flex.flex-wrap.gap-1\\.5')
      expect(wrapper).toBeInTheDocument()
    })

    it('should apply correct classes to badges', () => {
      render(<PluginKeywords keywords={['test']} />)

      const badge = screen.getByText('test')
      expect(badge).toHaveClass('text-xs', 'py-0.5', 'px-1.5')
    })
  })

  describe('edge cases', () => {
    it('should handle very long keyword', () => {
      const longKeyword = 'a'.repeat(100)
      render(<PluginKeywords keywords={[longKeyword]} />)

      expect(screen.getByText(longKeyword)).toBeInTheDocument()
    })

    it('should handle many keywords', () => {
      const manyKeywords = Array.from({ length: 50 }, (_, i) => `keyword-${i}`)
      render(<PluginKeywords keywords={manyKeywords} />)

      manyKeywords.forEach(keyword => {
        expect(screen.getByText(keyword)).toBeInTheDocument()
      })
    })

    it('should handle keywords with special characters', () => {
      const keywords = ['react@18', 'node.js', 'c++', 'c#']
      render(<PluginKeywords keywords={keywords} />)

      keywords.forEach(keyword => {
        expect(screen.getByText(keyword)).toBeInTheDocument()
      })
    })

    it('should handle keywords with spaces', () => {
      const keywords = ['web development', 'machine learning']
      render(<PluginKeywords keywords={keywords} />)

      keywords.forEach(keyword => {
        expect(screen.getByText(keyword)).toBeInTheDocument()
      })
    })

    it('should handle keywords with unicode', () => {
      const keywords = ['中文', 'العربية', '🚀 rocket']
      render(<PluginKeywords keywords={keywords} />)

      keywords.forEach(keyword => {
        expect(screen.getByText(keyword)).toBeInTheDocument()
      })
    })

    it('should handle empty string keywords', () => {
      const keywords = ['', 'valid', '']
      render(<PluginKeywords keywords={keywords} />)

      expect(screen.getByText('valid')).toBeInTheDocument()
      const badges = screen.queryAllByText('')
      expect(badges.length).toBeGreaterThan(0)
    })

    it('should handle whitespace keywords', () => {
      const keywords = ['   ', 'valid']
      render(<PluginKeywords keywords={keywords} />)

      expect(screen.getByText('valid')).toBeInTheDocument()
      expect(screen.getByText('   ')).toBeInTheDocument()
    })
  })

  describe('key generation', () => {
    it('should generate stable keys for rendering', () => {
      const keywords = ['test1', 'test2']
      const { rerender } = render(<PluginKeywords keywords={keywords} />)

      const initialBadges = screen.getAllByText(/test/)
      
      rerender(<PluginKeywords keywords={keywords} />)
      
      const rerenderedBadges = screen.getAllByText(/test/)
      expect(initialBadges).toHaveLength(rerenderedBadges.length)
    })
  })
})