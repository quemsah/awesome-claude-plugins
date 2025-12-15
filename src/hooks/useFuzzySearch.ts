import { useMemo } from 'react'
import type { Repo } from '../app/types/repo.type.ts'
import { createFuseIndex } from '../lib/fuzzySearch.ts'

export function useFuzzySearch(repos: Repo[], searchTerm: string): Repo[] {
  const fuse = useMemo(() => createFuseIndex(repos), [repos])

  return useMemo(() => {
    if (!searchTerm.trim()) {
      return repos
    }
    return fuse.search(searchTerm).map((result) => result.item)
  }, [fuse, searchTerm, repos])
}
