import type { components } from '@octokit/openapi-types'
import { useEffect, useState } from 'react'
import type { Plugin } from '../app/types/plugin.type.ts'

type Repository = components['schemas']['repository']

export function usePlugins(repo: Repository | null, repoPath: string) {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [pluginsLoading, setPluginsLoading] = useState(true)
  const [pluginsError, setPluginsError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        if (!repo) return

        setPluginsLoading(true)

        const defaultBranch = repo.default_branch
        const pluginsResponse = await fetch(
          `https://raw.githubusercontent.com/${repoPath}/${defaultBranch}/.claude-plugin/marketplace.json`
        )

        if (!pluginsResponse.ok) {
          if (pluginsResponse.status !== 404) {
            setPluginsError('Failed to load plugins')
          }
          setPlugins([])
          return
        }

        const pluginsData = await pluginsResponse.json()
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
