/** biome-ignore-all lint/security/noDangerouslySetInnerHtml: <Used to inject ld+json> */
import { BASE_URL } from '../../lib/constants.ts'

interface StatsStructuredDataProps {
  startDate?: string
  endDate?: string
}

export default function StatsStructuredData({ startDate, endDate }: StatsStructuredDataProps) {
  const temporalCoverage =
    startDate && endDate ? `${new Date(startDate).toISOString().split('T')[0]}/${new Date(endDate).toISOString().split('T')[0]}` : '2026'

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Repository Statistics | Awesome Claude Plugins',
    description: 'View statistics and trends about Claude Code plugin adoption across GitHub repositories',
    url: `${BASE_URL}/stats`,
    about: {
      '@type': 'Dataset',
      name: 'Claude Code Plugin Adoption Statistics',
      description: 'Daily statistics showing the growth of repositories adopting Claude Code plugins over time',
      variableMeasured: 'Repository Count',
      temporalCoverage,
      license: 'https://creativecommons.org/publicdomain/zero/1.0/',
      isAccessibleForFree: true,
      creator: {
        '@type': 'Organization',
        name: 'Awesome Claude Plugins Team',
        url: BASE_URL,
      },
    },
    publisher: {
      '@type': 'Organization',
      name: 'Awesome Claude Plugins Team',
      url: BASE_URL,
    },
  }

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: BASE_URL,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Statistics',
        item: `${BASE_URL}/stats`,
      },
    ],
  }

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} type="application/ld+json" />
      <script dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} type="application/ld+json" />
    </>
  )
}
