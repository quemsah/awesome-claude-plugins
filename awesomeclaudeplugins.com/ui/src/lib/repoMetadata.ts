/** Shared, browser-safe archived-status detection for cards and list sorting. */
export function isArchivedRepo(repo: { archived?: boolean | null; description?: string | null }): boolean {
  return repo.archived === true || /^\[archived\]/i.test(repo.description?.trim() ?? '')
}
