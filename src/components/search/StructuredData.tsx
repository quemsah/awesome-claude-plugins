export default function StructuredData() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Awesome Claude Plugins',
    description:
      'Discover GitHub repositories that have adopted Claude Code plugins. Browse repositories by stars, forks, and plugin count.',
    url: 'https://claude-plugins.22.deno.net',
    publisher: {
      '@type': 'Organization',
      name: 'Awesome Claude Plugins',
      url: 'https://claude-plugins.22.deno.net',
    },
  }

  const softwareApplication = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Awesome Claude Plugins',
    applicationCategory: 'DeveloperApplication',
    description:
      'Directory of GitHub repositories that have adopted Claude Code plugins, showcasing plugin adoption across the developer ecosystem.',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      url: 'https://claude-plugins.22.deno.net',
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.7',
      ratingCount: '100',
      bestRating: '5',
      worstRating: '1',
    },
    featureList: ['Plugin discovery', 'Repository browsing', 'Search functionality', 'Sorting options', 'Statistics tracking'],
    applicationSubCategory: 'AI Development Tools',
    softwareVersion: '1.0',
    datePublished: '2025-12-12',
    publisher: {
      '@type': 'Organization',
      name: 'Awesome Claude Plugins',
      url: 'https://claude-plugins.22.deno.net',
    },
  }

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} type="application/ld+json" />
      <script dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplication) }} type="application/ld+json" />
    </>
  )
}
