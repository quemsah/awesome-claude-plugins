import type { components } from '@octokit/openapi-types'
import { useCallback, useEffect, useRef, useState } from 'react'

type Repository = components['schemas']['repository']

export type RepoFetchErrorKind = 'not_found' | 'rate_limited' | 'network' | 'invalid_json' | 'server'

export interface RepoFetchError {
  kind: RepoFetchErrorKind
  message: string
  retryable: boolean
}

export function useRepo(repoPath: string) {
  const [repo, setRepo] = useState<Repository | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<RepoFetchError | null>(null)
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
        applyState(() => {
          setLoading(true)
          setError(null)
        })

        const resp = await fetch(`https://api.github.com/repos/${repoPath}`, {
          cache: retryCount > 0 ? 'no-store' : 'default',
          signal: controller.signal,
        })

        if (!resp.ok) {
          applyState(() => {
            setRepo(null)
            setError(getRepoFetchError(resp))
          })
          return
        }

        try {
          const data = (await resp.json()) as Repository
          applyState(() => setRepo(data))
        } catch {
          applyState(() => {
            setRepo(null)
            setError({
              kind: 'invalid_json',
              message: 'GitHub returned an unreadable repository response.',
              retryable: true,
            })
          })
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        applyState(() => {
          setRepo(null)
          setError({
            kind: 'network',
            message: 'Network error while loading repository metadata.',
            retryable: true,
          })
        })
      } finally {
        applyState(() => setLoading(false))
      }
    })()

    return () => controller.abort()
  }, [repoPath, retryCount])

  return { repo, loading, error, retry }
}

function getRepoFetchError(response: Response): RepoFetchError {
  if (response.status === 404) {
    return {
      kind: 'not_found',
      message: 'Repository not found.',
      retryable: false,
    }
  }

  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    return {
      kind: 'rate_limited',
      message: 'GitHub rate limit reached while loading repository metadata.',
      retryable: true,
    }
  }

  return {
    kind: 'server',
    message: `GitHub returned ${response.status} while loading repository metadata.`,
    retryable: response.status >= 500 || response.status === 429 || response.status === 403,
  }
}
