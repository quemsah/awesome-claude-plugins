/** biome-ignore-all lint/security/noDangerouslySetInnerHtml: <Used to inject ld+json> */
import type { Repo } from '../../schemas/repo.schema.ts'

interface StructuredDataProps {
  repos: Repo[]
}

export default function StructuredData({ repos }: StructuredDataProps) {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Awesome Claude Plugins',
    description:
      'Discover GitHub repositories that have adopted Claude Code plugins. Browse repositories by stars, forks, and plugin count',
    url: 'https://awesomeclaudeplugins.com',
    publisher: {
      '@type': 'Organization',
      name: 'Awesome Claude Plugins Team',
      url: 'https://awesomeclaudeplugins.com',
    },
  }

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: repos.slice(0, 16).map((repo, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: repo.repo_name,
      ...(repo.description && { description: repo.description }),
      url: `https://github.com/${repo.owner}/${repo.repo_name}`,
    })),
  }

  const softwareApplication = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Awesome Claude Plugins',
    applicationCategory: 'DeveloperApplication',
    description:
      'Directory of GitHub repositories that have adopted Claude Code plugins, showcasing plugin adoption across the developer ecosystem',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      url: 'https://awesomeclaudeplugins.com',
    },
    featureList: [
      'Claude Code plugin adoption tracking',
      'MCP server discovery',
      'Agent skills marketplace',
      'AI-powered repository browsing',
      'Advanced search functionality',
      'Multi-criteria sorting options',
      'Comprehensive statistics tracking',
      'Plugin adoption growth analytics',
      'Automated workflow monitoring',
      'GitHub integration metrics',
    ],
    applicationSubCategory: 'AI Development Analytics',
    softwareVersion: '1.0',
    datePublished: '2025-12-12',
    publisher: {
      '@type': 'Organization',
      name: 'Awesome Claude Plugins Team',
      url: 'https://awesomeclaudeplugins.com',
    },
  }

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} type="application/ld+json" />
      <script dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }} type="application/ld+json" />
      <script dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplication) }} type="application/ld+json" />
    </>
  )
}
