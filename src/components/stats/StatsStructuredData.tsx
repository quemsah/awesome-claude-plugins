/** biome-ignore-all lint/security/noDangerouslySetInnerHtml: <Used to inject ld+json> */
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
    url: 'https://awesomeclaudeplugins.com/stats',
    about: {
      '@type': 'Dataset',
      name: 'Claude Code Plugin Adoption Statistics',
      description: 'Daily statistics showing the growth of repositories adopting Claude Code plugins over time',
      variableMeasured: 'Repository Count',
      temporalCoverage,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Awesome Claude Plugins Team',
      url: 'https://awesomeclaudeplugins.com',
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
        item: 'https://awesomeclaudeplugins.com',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Statistics',
        item: 'https://awesomeclaudeplugins.com/stats',
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
