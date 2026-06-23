const DEFAULT_SITE_URL = 'https://awesomeclaudeplugins.com'
const TRAILING_SLASHES = /\/+$/

export const BASE_URL = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL)

function normalizeSiteUrl(siteUrl: string | undefined) {
  const normalizedSiteUrl = siteUrl?.trim().replace(TRAILING_SLASHES, '')

  if (!normalizedSiteUrl) {
    return DEFAULT_SITE_URL
  }

  try {
    return new URL(normalizedSiteUrl).origin
  } catch {
    return DEFAULT_SITE_URL
  }
}
