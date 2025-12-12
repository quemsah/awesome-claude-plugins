import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PluginHeader } from '../../../components/repo/PluginHeader'

describe('PluginHeader', () => {
  describe('rendering with name', () => {
    it('should render plugin name', () => {
      render(<PluginHeader name="Test Plugin" />)

      expect(screen.getByText('Test Plugin')).toBeInTheDocument()
    })

    it('should render name with version', () => {
      render(<PluginHeader name="Test Plugin" version="1.0.0" />)

      expect(screen.getByText('Test Plugin')).toBeInTheDocument()
      expect(screen.getByText('@1.0.0')).toBeInTheDocument()
    })

    it('should render "Unnamed Plugin" when name is undefined', () => {
      render(<PluginHeader name={undefined} />)

      expect(screen.getByText('Unnamed Plugin')).toBeInTheDocument()
    })

    it('should render "Unnamed Plugin" when name is empty string', () => {
      render(<PluginHeader name="" />)

      expect(screen.getByText('Unnamed Plugin')).toBeInTheDocument()
    })
  })

  describe('rendering with category', () => {
    it('should render category badge', () => {
      render(<PluginHeader name="Test Plugin" category="utility" />)

      expect(screen.getByText('utility')).toBeInTheDocument()
    })

    it('should not render badge when category is undefined', () => {
      render(<PluginHeader name="Test Plugin" category={undefined} />)

      expect(screen.queryByRole('badge')).not.toBeInTheDocument()
    })

    it('should not render badge when category is empty string', () => {
      render(<PluginHeader name="Test Plugin" category="" />)

      expect(screen.queryByRole('badge')).not.toBeInTheDocument()
    })
  })

  describe('rendering combinations', () => {
    it('should render all props together', () => {
      render(<PluginHeader name="Full Plugin" version="2.5.0" category="development" />)

      expect(screen.getByText('Full Plugin')).toBeInTheDocument()
      expect(screen.getByText('@2.5.0')).toBeInTheDocument()
      expect(screen.getByText('development')).toBeInTheDocument()
    })

    it('should handle version without name', () => {
      render(<PluginHeader name={undefined} version="1.0.0" />)

      expect(screen.getByText('Unnamed Plugin')).toBeInTheDocument()
      expect(screen.getByText('@1.0.0')).toBeInTheDocument()
    })

    it('should handle category without name', () => {
      render(<PluginHeader name={undefined} category="test" />)

      expect(screen.getByText('Unnamed Plugin')).toBeInTheDocument()
      expect(screen.getByText('test')).toBeInTheDocument()
    })
  })

  describe('styling', () => {
    it('should apply correct classes to CardTitle', () => {
      render(<PluginHeader name="Test Plugin" />)

      const title = screen.getByText('Test Plugin').closest('.text-lg')
      expect(title).toHaveClass('text-lg', 'font-bold', 'group-hover:text-primary', 'transition-colors', 'duration-300')
    })

    it('should apply muted-foreground to version', () => {
      render(<PluginHeader name="Test" version="1.0.0" />)

      const versionElement = screen.getByText('@1.0.0')
      expect(versionElement).toHaveClass('text-muted-foreground')
    })

    it('should apply correct classes to category badge', () => {
      render(<PluginHeader name="Test" category="utility" />)

      const badge = screen.getByText('utility')
      expect(badge).toHaveClass('ml-3', 'text-xs')
    })
  })

  describe('edge cases', () => {
    it('should handle very long plugin name', () => {
      const longName = 'A'.repeat(200)
      render(<PluginHeader name={longName} />)

      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('should handle special characters in name', () => {
      const name = 'Plugin @#$% & Name'
      render(<PluginHeader name={name} />)

      expect(screen.getByText(name)).toBeInTheDocument()
    })

    it('should handle version with special format', () => {
      render(<PluginHeader name="Test" version="1.0.0-alpha.1+build.123" />)

      expect(screen.getByText('@1.0.0-alpha.1+build.123')).toBeInTheDocument()
    })

    it('should handle unicode in name', () => {
      const name = '🚀 Plugin 中文'
      render(<PluginHeader name={name} />)

      expect(screen.getByText(name)).toBeInTheDocument()
    })

    it('should handle unicode in category', () => {
      const category = 'カテゴリー'
      render(<PluginHeader name="Test" category={category} />)

      expect(screen.getByText(category)).toBeInTheDocument()
    })

    it('should handle whitespace in version', () => {
      render(<PluginHeader name="Test" version="  1.0.0  " />)

      expect(screen.getByText('@  1.0.0  ')).toBeInTheDocument()
    })
  })
})