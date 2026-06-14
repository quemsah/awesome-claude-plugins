import type { components } from '@octokit/openapi-types'
import { useEffect, useState } from 'react'

type Repository = components['schemas']['repository']

type CacheEntry = {
  data: Repository
  expiresAt: number
}

const MAX_PREFETCH_CACHE_ENTRIES = 50
const PREFETCH_CACHE_TTL_MS = 5 * 60 * 1000
const prefetchCache = new Map<string, CacheEntry>()
const prefetchInFlight = new Map<string, Promise<Repository | null>>()

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function getFreshCachedRepo(repoPath: string): Repository | null {
  const entry = prefetchCache.get(repoPath)
  if (!entry) return null

  if (entry.expiresAt <= Date.now()) {
    prefetchCache.delete(repoPath)
    return null
  }

  prefetchCache.delete(repoPath)
  prefetchCache.set(repoPath, entry)
  return entry.data
}

function setCachedRepo(repoPath: string, data: Repository): void {
  prefetchCache.delete(repoPath)
  prefetchCache.set(repoPath, {
    data,
    expiresAt: Date.now() + PREFETCH_CACHE_TTL_MS,
  })

  while (prefetchCache.size > MAX_PREFETCH_CACHE_ENTRIES) {
    const oldestKey = prefetchCache.keys().next().value
    if (!oldestKey) break
    prefetchCache.delete(oldestKey)
  }
}

function getRepoApiUrl(repoPath: string): string | null {
  const normalizedRepoPath = repoPath.trim()
  const [owner, repoName, extraSegment] = normalizedRepoPath.split('/')

  if (!(owner && repoName) || extraSegment) return null

  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`
}

async function fetchRepoData(repoPath: string, signal?: AbortSignal): Promise<Repository | null> {
  const apiUrl = getRepoApiUrl(repoPath)
  if (!apiUrl) return null

  const resp = await fetch(apiUrl, { signal })
  if (!resp.ok) return null

  return (await resp.json()) as Repository
}

export function useRepo(repoPath: string) {
  const [repo, setRepo] = useState<Repository | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    const controller = new AbortController()
    const cachedRepo = getFreshCachedRepo(repoPath)

    if (cachedRepo) {
      setRepo(cachedRepo)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const prefetchedRepo = await prefetchRepo(repoPath)
        if (!isMounted || controller.signal.aborted) return

        if (prefetchedRepo) {
          setRepo(prefetchedRepo)
          return
        }

        const data = await fetchRepoData(repoPath, controller.signal)
        if (!isMounted || controller.signal.aborted) return

        if (data) {
          setCachedRepo(repoPath, data)
          setRepo(data)
          return
        }

        setError('Repository not found')
      } catch (err) {
        if (!isMounted || isAbortError(err)) return
        setError('Failed to load repository')
      } finally {
        if (isMounted && !controller.signal.aborted) {
          setLoading(false)
        }
      }
    })()

    return () => {
      isMounted = false
      controller.abort()
    }
  }, [repoPath])

  return { repo, loading, error }
}

export function prefetchRepo(repoPath: string): Promise<Repository | null> {
  const cachedRepo = getFreshCachedRepo(repoPath)
  if (cachedRepo) return Promise.resolve(cachedRepo)

  const inFlightRequest = prefetchInFlight.get(repoPath)
  if (inFlightRequest) return inFlightRequest

  const request = fetchRepoData(repoPath)
    .then((data) => {
      if (data) setCachedRepo(repoPath, data)
      return data
    })
    .catch(() => null)
    .finally(() => {
      prefetchInFlight.delete(repoPath)
    })

  prefetchInFlight.set(repoPath, request)
  return request
}
