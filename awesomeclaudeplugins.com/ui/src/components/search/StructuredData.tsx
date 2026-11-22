/** biome-ignore-all lint/security/noDangerouslySetInnerHtml: <Used to inject ld+json> */

import { getRepoCanonicalPath } from '../../lib/catalog.ts'
import { BASE_URL } from '../../lib/constants.ts'
import { HOME_PAGE_DESCRIPTION } from '../../lib/homePageMetadata.ts'
import { serializeJsonLd } from '../../lib/jsonLd.ts'
import type { Repo } from '../../schemas/repo.schema.ts'

interface StructuredDataProps {
  repos: readonly Repo[]
}

export default function StructuredData({ repos }: StructuredDataProps) {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Awesome Claude Plugins',
    description: HOME_PAGE_DESCRIPTION,
    url: BASE_URL,
  }

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: repos.slice(0, 16).map((repo, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: repo.repo_name,
      ...(repo.description && { description: repo.description }),
      url: `${BASE_URL}/${getRepoCanonicalPath(repo)}`,
    })),
  }

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} type="application/ld+json" />
      <script dangerouslySetInnerHTML={{ __html: serializeJsonLd(itemList) }} type="application/ld+json" />
    </>
  )
}
