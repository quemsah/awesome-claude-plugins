/**
 * Fuzzy search cost grows linearly past Fuse's 32-character bitap pattern limit, so longer queries are truncated rather than rejected:
 * the search box has no length limit and a 400 would surface to the user as a load error.
 */
export const MAX_QUERY_LENGTH = 32

/**
 * Canonical form of a catalog search query, applied by every surface that searches so the server render and
 * `/api/catalog` cannot disagree. Trims before capping so leading whitespace cannot eat part of the query.
 */
export function normalizeSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase().slice(0, MAX_QUERY_LENGTH)
}
