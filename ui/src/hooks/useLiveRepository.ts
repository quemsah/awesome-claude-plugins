'use client'

import { useEffect, useState } from 'react'
import { type RequestedRepository, readLiveRepository } from '../lib/liveRepository.ts'
import type { CatalogSnapshotReason } from '../lib/repositorySnapshot.ts'
import type { GitHubRepository } from '../schemas/github.schema.ts'

export type LiveRepositoryState = {
  liveRepo: GitHubRepository | null
  liveReason: CatalogSnapshotReason | null
}

/** GitHub's REST API answers JSON without an `accept` header, so the request stays header-free. */
export function useLiveRepository(apiBaseUrl: string, { owner, repoName }: RequestedRepository): LiveRepositoryState {
  const [state, setState] = useState<LiveRepositoryState>({ liveRepo: null, liveReason: null })

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function loadLiveRepository() {
      try {
        const response = await fetch(`${apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`, {
          signal: controller.signal,
        })
        const payload: unknown = await response.json().catch(() => null)
        const result = readLiveRepository(response.status, payload, { owner, repoName })
        if (!cancelled) {
          setState(result.ok ? { liveRepo: result.repository, liveReason: null } : { liveRepo: null, liveReason: result.reason })
        }
      } catch {
        // The cleanup flags the effect cancelled before it aborts, so an abort never reaches state.
        if (!cancelled) {
          setState({ liveRepo: null, liveReason: 'github-unavailable' })
        }
      }
    }

    loadLiveRepository()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [apiBaseUrl, owner, repoName])

  return state
}
