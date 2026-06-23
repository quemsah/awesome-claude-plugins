import type { components } from '@octokit/openapi-types'
import type { Plugin } from '../app/types/plugin.type.ts'

type Repository = components['schemas']['repository']

const repoDetailRevalidateSeconds = 60 * 60

export interface RepoFetchResult {
  repo: Repository | null
  error: string | null
}

export interface PluginFetchResult {
  plugins: Plugin[]
  error: string | null
}

export function parseRepoPath(parts: string[]): string | null {
  if (parts.length !== 2 || parts.some((part) => part.trim() === '')) {
    return null
  }

  return parts.map((part) => encodeURIComponent(part)).join('/')
}

export async function fetchRepoDetails(repoPath: string): Promise<RepoFetchResult> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repoPath}`, {
      next: {
        revalidate: repoDetailRevalidateSeconds,
      },
    })

    if (response.status === 404) {
      return { repo: null, error: 'Repository not found' }
    }

    if (!response.ok) {
      return { repo: null, error: 'Failed to load repository' }
    }

    return { repo: (await response.json()) as Repository, error: null }
  } catch {
    return { repo: null, error: 'Failed to load repository' }
  }
}

export async function fetchRepoPlugins(repoPath: string, defaultBranch: string): Promise<PluginFetchResult> {
  try {
    const response = await fetch(
      `https://raw.githubusercontent.com/${repoPath}/${encodeURIComponent(defaultBranch)}/.claude-plugin/marketplace.json`,
      {
        next: {
          revalidate: repoDetailRevalidateSeconds,
        },
      }
    )

    if (response.status === 404) {
      return { plugins: [], error: null }
    }

    if (!response.ok) {
      return { plugins: [], error: 'Failed to load plugins' }
    }

    const manifest = await response.json()
    return { plugins: normalizePlugins(manifest), error: null }
  } catch {
    return { plugins: [], error: 'Failed to load plugins' }
  }
}

function normalizePlugins(manifest: unknown): Plugin[] {
  if (Array.isArray(manifest)) {
    return manifest as Plugin[]
  }

  if (isPluginManifest(manifest)) {
    return manifest.plugins
  }

  return []
}

function isPluginManifest(manifest: unknown): manifest is { plugins: Plugin[] } {
  return typeof manifest === 'object' && manifest !== null && 'plugins' in manifest && Array.isArray(manifest.plugins)
}
