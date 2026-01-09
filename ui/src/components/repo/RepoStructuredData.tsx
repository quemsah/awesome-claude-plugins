/** biome-ignore-all lint/security/noDangerouslySetInnerHtml: <Used to inject ld+json> */
import type { components } from '@octokit/openapi-types'
import { BASE_URL } from '../../lib/constants.ts'

type Repository = components['schemas']['repository']

interface RepoStructuredDataProps {
  repo: Repository
}

export default function RepoStructuredData({ repo }: RepoStructuredDataProps) {
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
        name: repo.name,
        item: `${BASE_URL}/${repo.full_name}`,
      },
    ],
  }

  const softwareSourceCode = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: repo.name,
    description: repo.description || 'GitHub repository with Claude Code plugin adoption',
    url: repo.html_url,
    codeRepository: repo.html_url,
    programmingLanguage: repo.language || 'Unknown',
    dateCreated: repo.created_at,
    dateModified: repo.pushed_at,
    author:
      repo.owner.type === 'Organization'
        ? {
            '@type': 'Organization',
            name: repo.owner.login,
            url: repo.owner.html_url,
          }
        : {
            '@type': 'Person',
            name: repo.owner.login,
            url: repo.owner.html_url,
          },
    license: repo.license?.name || 'Unknown',
    keywords: repo.topics?.join(', ') || 'Claude Code, plugin adoption, GitHub, metrics',
    isPartOf: {
      '@type': 'WebSite',
      name: 'Awesome Claude Plugins',
      url: BASE_URL,
    },
  }

  const organization =
    repo.owner.type === 'Organization'
      ? {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: repo.owner.login,
          url: repo.owner.html_url,
          sameAs: [repo.owner.html_url],
        }
      : null

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} type="application/ld+json" />
      <script dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSourceCode) }} type="application/ld+json" />
      {organization ? <script dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }} type="application/ld+json" /> : null}
    </>
  )
}
