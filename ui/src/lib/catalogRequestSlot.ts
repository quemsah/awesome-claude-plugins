export type CatalogRequestKind = 'append' | 'replace'

/**
 * Who may take the single catalog request slot. A replacement always takes it: a new search or sort
 * supersedes whatever is in flight. An append takes it only while nothing holds it, because taking it
 * from a running replacement would abort that replacement and append its page onto the list the
 * replacement was about to discard.
 */
export function mayStartCatalogRequest(held: CatalogRequestKind | null, next: CatalogRequestKind): boolean {
  return next === 'replace' || held === null
}
