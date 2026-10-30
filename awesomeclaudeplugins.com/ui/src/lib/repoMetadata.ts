const ARCHIVED_PREFIX = /^\[archived\]/i

/** Shared, browser-safe archived-status detection for cards and list sorting. */
export function isArchivedRepo(repo: { archived?: boolean | null; description?: string | null }): boolean {
  return repo.archived === true || (repo.archived == null && ARCHIVED_PREFIX.test(repo.description?.trim() ?? ''))
}
