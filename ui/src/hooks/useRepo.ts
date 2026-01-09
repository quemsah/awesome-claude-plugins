import type { components } from '@octokit/openapi-types'
import { useEffect, useState } from 'react'

type Repository = components['schemas']['repository']

export function useRepo(repoPath: string) {
  const [repo, setRepo] = useState<Repository | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    ;(async () => {
      try {
        const resp = await fetch(`https://api.github.com/repos/${repoPath}`, {
          signal: controller.signal,
        })
        if (!resp.ok) {
          if (resp.status === 404) {
            setError('Repository not found')
          } else {
            setError('Failed to load repository')
          }
          return
        }
        const data = (await resp.json()) as Repository
        setRepo(data)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        setError('Failed to load repository')
      } finally {
        setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [repoPath])

  return { repo, loading, error }
}
