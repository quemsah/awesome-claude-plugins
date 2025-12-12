import type { components } from '@octokit/openapi-types'
import { useEffect, useState } from 'react'

type Repository = components['schemas']['repository']

type PluginAuthor = {
  name?: string
  email?: string
}

type Plugin = {
  name?: string
  description?: string
  version?: string
  id?: string
  source?: string
  category?: string
  author?: PluginAuthor
  license?: string
  keywords?: string[]
  strict?: boolean
  commands?: string[]
  agents?: string[]
  mcpServers?: string[]
}

export function usePlugins(repo: Repository | null, repoPath: string) {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [pluginsLoading, setPluginsLoading] = useState(true)
  const [pluginsError, setPluginsError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        // Only fetch plugins if repo data is available
        if (!repo) return

        setPluginsLoading(true)

        // Use the default_branch from the already-fetched repo data
        const defaultBranch = repo.default_branch

        // Fetch the marketplace.json file from the .claude-plugin directory
        const pluginsResponse = await fetch(
          `https://raw.githubusercontent.com/${repoPath}/${defaultBranch}/.claude-plugin/marketplace.json`
        )

        if (!pluginsResponse.ok) {
          if (pluginsResponse.status === 404) {
            // marketplace.json not found, set empty plugins array
            setPlugins([])
          } else {
            setPluginsError('Failed to load plugins')
          }
          return
        }

        const pluginsData = await pluginsResponse.json()
        // Handle different marketplace.json structures
        if (Array.isArray(pluginsData)) {
          setPlugins(pluginsData)
        } else if (pluginsData.plugins && Array.isArray(pluginsData.plugins)) {
          setPlugins(pluginsData.plugins)
        } else {
          setPlugins([])
        }
      } catch {
        setPluginsError('Failed to load plugins')
      } finally {
        setPluginsLoading(false)
      }
    })()
  }, [repo, repoPath])

  return { plugins, pluginsLoading, pluginsError }
}
