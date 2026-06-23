/** biome-ignore-all lint/security/noDangerouslySetInnerHtml: <Used to inject ld+json> */

import { BASE_URL } from '../../lib/constants.ts'
import type { Repo } from '../../schemas/repo.schema.ts'

interface StructuredDataProps {
  repos: Repo[]
}

export default function StructuredData({ repos }: StructuredDataProps) {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Awesome Claude Plugins',
    description: 'Search a generated catalog of GitHub repositories related to Claude Code plugins, MCP servers, and agent skills',
    url: BASE_URL,
    publisher: {
      '@type': 'Organization',
      name: 'Awesome Claude Plugins Team',
      url: BASE_URL,
    },
  }

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: repos.length,
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
    description: 'Generated web catalog for browsing GitHub repositories related to Claude Code plugins, MCP servers, and agent skills',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      url: BASE_URL,
    },
    featureList: [
      'Repository catalog browsing',
      'Client-side repository search',
      'Sorting by stars, forks, and plugin count',
      'Copyable Claude plugin marketplace install commands',
      'Repository detail pages linked to GitHub data',
      'Historical repository count statistics',
      'Machine-readable llms.txt and JSON-LD metadata',
    ],
    applicationSubCategory: 'AI Development Analytics',
    softwareVersion: '1.0',
    datePublished: '2025-12-12',
    publisher: {
      '@type': 'Organization',
      name: 'Awesome Claude Plugins Team',
      url: BASE_URL,
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
