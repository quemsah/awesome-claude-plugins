interface StatsStructuredDataProps {
  startDate?: string
  endDate?: string
}

export default function StatsStructuredData({ startDate, endDate }: StatsStructuredDataProps) {
  const temporalCoverage =
    startDate && endDate
      ? `${new Date(startDate).toISOString().split('T')[0]}/${new Date(endDate).toISOString().split('T')[0]}`
      : '2026'

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Repository Statistics | Awesome Claude Code Plugins',
    description: 'View statistics and trends about Claude Code plugin adoption across GitHub repositories',
    url: 'https://claude-plugins.22.deno.net/stats',
    about: {
      '@type': 'Dataset',
      name: 'Claude Code Plugin Adoption Statistics',
      description: 'Daily statistics showing the growth of repositories adopting Claude Code plugins over time',
      variableMeasured: 'Repository Count',
      temporalCoverage,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Awesome Claude Plugins',
      url: 'https://claude-plugins.22.deno.net',
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
        item: 'https://claude-plugins.22.deno.net',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Statistics',
        item: 'https://claude-plugins.22.deno.net/stats',
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
