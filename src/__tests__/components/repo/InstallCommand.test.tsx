import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { InstallCommand } from '../../../components/repo/InstallCommand'

describe('InstallCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('rendering', () => {
    it('should render install command with plugin name', () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      expect(screen.getByText('/plugin install test-plugin@owner-repo')).toBeInTheDocument()
    })

    it('should render install command with plugin id', () => {
      render(<InstallCommand pluginName="test-plugin" pluginId="plugin-123" repoPath="owner/repo" />)

      expect(screen.getByText('/plugin install test-plugin@plugin-123')).toBeInTheDocument()
    })

    it('should render copy button', () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const button = screen.getByRole('button', { name: /copy installation command/i })
      expect(button).toBeInTheDocument()
    })

    it('should render command in code block', () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const code = screen.getByText('/plugin install test-plugin@owner-repo')
      expect(code.tagName).toBe('CODE')
      expect(code).toHaveClass('text-sm', 'font-mono', 'break-all', 'flex-grow')
    })
  })

  describe('copy functionality', () => {
    it('should copy command to clipboard on button click', async () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const button = screen.getByRole('button', { name: /copy installation command/i })
      fireEvent.click(button)

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/plugin install test-plugin@owner-repo')
      })
    })

    it('should show copied state after clicking', async () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const button = screen.getByRole('button', { name: /copy installation command/i })
      fireEvent.click(button)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /installation command copied/i })).toBeInTheDocument()
      })
    })

    it('should reset to copy state after 500ms', async () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const button = screen.getByRole('button', { name: /copy installation command/i })
      fireEvent.click(button)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /installation command copied/i })).toBeInTheDocument()
      })

      vi.advanceTimersByTime(500)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /copy installation command/i })).toBeInTheDocument()
      })
    })

    it('should show copy icon initially', () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const button = screen.getByRole('button')
      const svg = button.querySelector('svg')
      const title = svg?.querySelector('title')
      expect(title?.textContent).toBe('Copy')
    })

    it('should show checkmark icon when copied', async () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      await waitFor(() => {
        const svg = button.querySelector('svg')
        const title = svg?.querySelector('title')
        expect(title?.textContent).toBe('Copied')
      })
    })
  })

  describe('styling', () => {
    it('should apply correct wrapper classes', () => {
      const { container } = render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const wrapper = container.querySelector('.px-6.pb-4')
      expect(wrapper).toBeInTheDocument()
    })

    it('should apply correct classes to command container', () => {
      const { container } = render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const commandContainer = container.querySelector('.bg-muted\\/50.rounded-md.p-3.border')
      expect(commandContainer).toBeInTheDocument()
    })

    it('should change button styling when copied', async () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('hover:bg-muted')

      fireEvent.click(button)

      await waitFor(() => {
        expect(button).toHaveClass('bg-green-500/20', 'text-green-600')
      })
    })

    it('should have flex-shrink-0 on button', () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('flex-shrink-0')
    })
  })

  describe('accessibility', () => {
    it('should have aria-label on button', () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'Copy installation command')
    })

    it('should update aria-label when copied', async () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      await waitFor(() => {
        expect(button).toHaveAttribute('aria-label', 'Installation command copied')
      })
    })

    it('should have title attribute on button', () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('title', 'Copy installation command')
    })

    it('should update title when copied', async () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      await waitFor(() => {
        expect(button).toHaveAttribute('title', 'Installation command copied')
      })
    })

    it('should have aria-hidden on SVG icons', () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const button = screen.getByRole('button')
      const svg = button.querySelector('svg')
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    })
  })

  describe('edge cases', () => {
    it('should handle undefined plugin name', () => {
      render(<InstallCommand pluginName={undefined} repoPath="owner/repo" />)

      expect(screen.getByText('/plugin install @owner-repo')).toBeInTheDocument()
    })

    it('should handle undefined plugin id', () => {
      render(<InstallCommand pluginName="test-plugin" pluginId={undefined} repoPath="owner/repo" />)

      expect(screen.getByText('/plugin install test-plugin@owner-repo')).toBeInTheDocument()
    })

    it('should handle very long plugin name', () => {
      const longName = 'a'.repeat(100)
      render(<InstallCommand pluginName={longName} repoPath="owner/repo" />)

      const command = screen.getByText(new RegExp(`/plugin install ${longName.toLowerCase()}`))
      expect(command).toBeInTheDocument()
    })

    it('should handle special characters in plugin name', () => {
      render(<InstallCommand pluginName="Plugin @#$ Name" repoPath="owner/repo" />)

      expect(screen.getByText('/plugin install plugin-@#$-name@owner-repo')).toBeInTheDocument()
    })

    it('should handle multiple rapid clicks', async () => {
      render(<InstallCommand pluginName="test-plugin" repoPath="owner/repo" />)

      const button = screen.getByRole('button')
      
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(3)
      })
    })
  })

  describe('command generation', () => {
    it('should prefer plugin id over repo path', () => {
      render(<InstallCommand pluginName="test" pluginId="id-123" repoPath="owner/repo" />)

      expect(screen.getByText('/plugin install test@id-123')).toBeInTheDocument()
    })

    it('should use repo path when no plugin id', () => {
      render(<InstallCommand pluginName="test" pluginId={undefined} repoPath="owner/repo" />)

      expect(screen.getByText('/plugin install test@owner-repo')).toBeInTheDocument()
    })

    it('should replace slash in repo path with hyphen', () => {
      render(<InstallCommand pluginName="test" repoPath="my-org/my-repo" />)

      expect(screen.getByText('/plugin install test@my-org-my-repo')).toBeInTheDocument()
    })

    it('should normalize plugin name', () => {
      render(<InstallCommand pluginName="My Plugin Name" repoPath="owner/repo" />)

      expect(screen.getByText('/plugin install my-plugin-name@owner-repo')).toBeInTheDocument()
    })
  })
})