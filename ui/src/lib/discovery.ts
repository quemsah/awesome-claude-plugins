import { CATALOG_PAGE_SIZE } from './catalogPagination.ts'
import { BASE_URL } from './constants.ts'
import { sortOptionValues } from './sortOptions.ts'

/** RFC 9727 §4.2: the linkset SHOULD declare this profile to signal conformance. */
export const API_CATALOG_PROFILE_URI = 'https://www.rfc-editor.org/info/rfc9727'
export const API_CATALOG_MEDIA_TYPE = 'application/linkset+json'

export interface ApiCatalogLink {
  /** RFC 9727 §3.1: `item` marks a member API, other relations describe the site itself. */
  rel: 'alternate' | 'describedby' | 'item' | 'manifest' | 'service-desc' | 'sitemap'
  href: string
  type: string
  title: string
}

export interface CatalogApiContract {
  defaultPageSize: number
  maxPageSize: number
  maxQueryLength: number
  requestsPerMinute: number
  responseFields: readonly string[]
  sortOptions: readonly string[]
}

/**
 * Single source of truth for the machine-readable surface: `/.well-known/api-catalog` serializes
 * these as a linkset, and both agent documents (`/llms.txt`, `/SKILL.md`) render from them.
 */
export const apiCatalogLinks: readonly ApiCatalogLink[] = [
  {
    rel: 'item',
    href: `${BASE_URL}/api/catalog`,
    type: 'application/json',
    title: 'Paged catalog search over every indexed repository',
  },
  {
    rel: 'item',
    href: `${BASE_URL}/feed.json`,
    type: 'application/feed+json',
    title: 'Latest catalog snapshot as a JSON Feed',
  },
  {
    rel: 'service-desc',
    href: `${BASE_URL}/.well-known/agent-skills/index.json`,
    type: 'application/json',
    title: 'Agent skill index for the catalog',
  },
  {
    rel: 'describedby',
    href: `${BASE_URL}/llms.txt`,
    type: 'text/plain',
    title: 'Site overview and resource index for language models',
  },
  {
    rel: 'describedby',
    href: `${BASE_URL}/SKILL.md`,
    type: 'text/markdown',
    title: 'Step-by-step agent instructions for using the catalog',
  },
  {
    rel: 'alternate',
    href: `${BASE_URL}/index.md`,
    type: 'text/markdown',
    title: 'Markdown rendition of the catalog home page',
  },
  {
    rel: 'alternate',
    href: `${BASE_URL}/stats.md`,
    type: 'text/markdown',
    title: 'Markdown rendition of the statistics page',
  },
  {
    rel: 'alternate',
    href: `${BASE_URL}/about.md`,
    type: 'text/markdown',
    title: 'Markdown rendition of the about page',
  },
  {
    rel: 'sitemap',
    href: `${BASE_URL}/sitemap.xml`,
    type: 'application/xml',
    title: 'Canonical repository URLs',
  },
  {
    rel: 'manifest',
    href: `${BASE_URL}/manifest.webmanifest`,
    type: 'application/manifest+json',
    title: 'Installable web app metadata',
  },
]

/** Mirrors the limits enforced in `src/app/api/catalog/route.ts`, which its contract tests pin. */
export const catalogApiContract: CatalogApiContract = {
  defaultPageSize: CATALOG_PAGE_SIZE,
  maxPageSize: 100,
  maxQueryLength: 32,
  requestsPerMinute: 100,
  responseFields: ['repos', 'total', 'hasMore', 'pluginsCount'],
  sortOptions: sortOptionValues,
}

export function buildApiCatalogLinkset(): { linkset: Record<string, unknown>[] } {
  const grouped = new Map<string, { href: string; type: string; title: string }[]>()

  for (const { rel, href, type, title } of apiCatalogLinks) {
    const links = grouped.get(rel) ?? []
    links.push({ href, type, title })
    grouped.set(rel, links)
  }

  return {
    linkset: [{ anchor: BASE_URL, ...Object.fromEntries(grouped) }],
  }
}

export function renderCatalogResourceLinks(): string {
  return apiCatalogLinks.map((link) => `- [${link.title}](${link.href}): \`${link.rel}\` with media type \`${link.type}\``).join('\n')
}

export function renderCatalogApiContract(): string {
  const contract = catalogApiContract

  return `- \`GET ${BASE_URL}/api/catalog\` returns one page of repositories as \`application/json\`.
- Query parameters: \`q\` (free text, matched fuzzily and truncated to ${contract.maxQueryLength} characters), \`sort\` (${contract.sortOptions.join(' | ')}), \`page\` (zero-based), \`pageSize\` (1-${contract.maxPageSize}, default ${contract.defaultPageSize}).
- Response fields: ${contract.responseFields.map((field) => `\`${field}\``).join(', ')} — \`repos\` is the page, \`total\` the number of matches, \`hasMore\` whether a next page exists and \`pluginsCount\` the plugins reported across all matches.
- Errors: \`400\` with \`{ "message": "Invalid pagination parameters" }\` for out-of-range \`page\` or \`pageSize\`, \`429\` with \`Retry-After\` beyond ${contract.requestsPerMinute} requests per minute.
- Unknown \`sort\` values fall back to the default order instead of failing, and a request that is valid but matches nothing returns an empty \`repos\` array with \`total: 0\`.`
}
