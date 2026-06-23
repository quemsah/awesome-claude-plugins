import type { components } from '@octokit/openapi-types'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Plugin } from '../app/types/plugin.type.ts'

type Repository = components['schemas']['repository']

export type PluginFetchErrorKind = 'rate_limited' | 'network' | 'invalid_json' | 'invalid_schema' | 'server'
export type PluginManifestStatus = 'available' | 'missing' | 'empty' | 'error'

export interface PluginFetchError {
  kind: PluginFetchErrorKind
  message: string
  retryable: boolean
}

export function usePlugins(repo: Repository | null, repoPath: string) {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [pluginsLoading, setPluginsLoading] = useState(true)
  const [pluginsError, setPluginsError] = useState<PluginFetchError | null>(null)
  const [manifestStatus, setManifestStatus] = useState<PluginManifestStatus>('empty')
  const [retryCount, setRetryCount] = useState(0)
  const requestId = useRef(0)

  const retry = useCallback(() => {
    setRetryCount((count) => count + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const currentRequestId = requestId.current + 1
    requestId.current = currentRequestId

    const applyState = (update: () => void) => {
      if (requestId.current === currentRequestId) {
        update()
      }
    }

    ;(async () => {
      try {
        if (!repo) {
          applyState(() => {
            setPlugins([])
            setPluginsLoading(false)
            setPluginsError(null)
            setManifestStatus('empty')
          })
          return
        }

        applyState(() => {
          setPluginsLoading(true)
          setPluginsError(null)
        })

        const defaultBranch = repo.default_branch
        const pluginsResponse = await fetch(
          `https://raw.githubusercontent.com/${repoPath}/${defaultBranch}/.claude-plugin/marketplace.json`,
          {
            cache: retryCount > 0 ? 'no-store' : 'default',
            signal: controller.signal,
          }
        )

        if (!pluginsResponse.ok) {
          applyState(() => {
            setPlugins([])
            if (pluginsResponse.status === 404) {
              setPluginsError(null)
              setManifestStatus('missing')
            } else {
              setPluginsError(getPluginFetchError(pluginsResponse))
              setManifestStatus('error')
            }
          })
          return
        }

        const manifestText = await pluginsResponse.text()
        const pluginsData = parsePluginManifest(manifestText)
        if (!pluginsData.ok) {
          applyState(() => {
            setPlugins([])
            setPluginsError(pluginsData.error)
            setManifestStatus('error')
          })
          return
        }

        applyState(() => {
          setPlugins(pluginsData.plugins)
          setPluginsError(null)
          setManifestStatus(pluginsData.plugins.length > 0 ? 'available' : 'empty')
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }
        applyState(() => {
          setPlugins([])
          setPluginsError({
            kind: 'network',
            message: 'Network error while loading the marketplace manifest.',
            retryable: true,
          })
          setManifestStatus('error')
        })
      } finally {
        applyState(() => setPluginsLoading(false))
      }
    })()

    return () => controller.abort()
  }, [repo, repoPath, retryCount])

  return { plugins, pluginsLoading, pluginsError, manifestStatus, retry }
}

function getPluginFetchError(response: Response): PluginFetchError {
  if (response.status === 403 || response.status === 429) {
    return {
      kind: 'rate_limited',
      message: 'GitHub rate limit reached while loading the marketplace manifest.',
      retryable: true,
    }
  }

  return {
    kind: 'server',
    message: `GitHub returned ${response.status} while loading the marketplace manifest.`,
    retryable: response.status >= 500,
  }
}

function parsePluginManifest(manifestText: string): { ok: true; plugins: Plugin[] } | { ok: false; error: PluginFetchError } {
  let manifest: unknown

  try {
    manifest = JSON.parse(manifestText)
  } catch {
    return {
      ok: false,
      error: {
        kind: 'invalid_json',
        message: 'The marketplace manifest is not valid JSON.',
        retryable: false,
      },
    }
  }

  if (Array.isArray(manifest)) {
    return { ok: true, plugins: manifest as Plugin[] }
  }

  if (typeof manifest === 'object' && manifest !== null && 'plugins' in manifest && Array.isArray(manifest.plugins)) {
    return { ok: true, plugins: manifest.plugins as Plugin[] }
  }

  return {
    ok: false,
    error: {
      kind: 'invalid_schema',
      message: 'The marketplace manifest does not match the expected plugin schema.',
      retryable: false,
    },
  }
}
