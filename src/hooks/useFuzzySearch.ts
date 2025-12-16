import { useMemo } from 'react'
import { createFuseIndex } from '../lib/fuzzySearch.ts'
import type { Repo } from '../schemas/repo.schema.ts'

export function useFuzzySearch(repos: Repo[], searchTerm: string): Repo[] {
  const fuse = useMemo(() => createFuseIndex(repos), [repos])

  return useMemo(() => {
    if (!searchTerm.trim()) {
      return repos
    }
    return fuse.search(searchTerm).map((result) => result.item)
  }, [fuse, searchTerm, repos])
}
