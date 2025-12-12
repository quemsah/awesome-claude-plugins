import type { components } from '@octokit/openapi-types'
import { useEffect, useState } from 'react'

type Repository = components['schemas']['repository']

export function useRepo(repoPath: string) {
  const [repo, setRepo] = useState<Repository | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const resp = await fetch(`https://api.github.com/repos/${repoPath}`)
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
      } catch {
        setError('Failed to load repository')
      } finally {
        setLoading(false)
      }
    })()
  }, [repoPath])

  return { repo, loading, error }
}
