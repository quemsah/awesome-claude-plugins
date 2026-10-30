/**
 * Maps a concrete pathname onto one of the fixed route templates this site serves.
 *
 * A raw pathname such as `/obra/superpowers` reveals which repository a visitor opened, so the
 * vitals endpoint reduces every incoming path through this function before recording it. Anything
 * that does not match a known page collapses to `UNMATCHED_ROUTE` instead of passing through,
 * which also keeps a hand-crafted request body from injecting arbitrary paths into the logs.
 */

const BROWSE_ROUTE = '/browse/[page]'
const REPOSITORY_ROUTE = '/[owner]/[repo]'
const STATIC_ROUTES = new Set(['/', '/about', '/privacy', '/stats'])
const RESERVED_REPOSITORY_ROOTS = new Set(['.well-known', '_next', 'api', 'browse', 'sitemap'])

export const UNMATCHED_ROUTE = 'other'

export function toRouteTemplate(pathname: string): string {
  const trimmed = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  const route = trimmed === '' ? '/' : trimmed

  if (STATIC_ROUTES.has(route)) {
    return route
  }

  const segments = route.split('/').filter((segment) => segment !== '')
  if (segments.length !== 2) {
    return UNMATCHED_ROUTE
  }

  if (segments[0] === 'browse') {
    return BROWSE_ROUTE
  }

  if (RESERVED_REPOSITORY_ROOTS.has(segments[0].toLowerCase())) {
    return UNMATCHED_ROUTE
  }

  return REPOSITORY_ROUTE
}
