/** biome-ignore-all lint/security/noDangerouslySetInnerHtml: <Used to inject ld+json> */
import { getRepoBreadcrumbs } from '../../lib/breadcrumbs.ts'
import { BASE_URL } from '../../lib/constants.ts'
import { serializeJsonLd } from '../../lib/jsonLd.ts'
import { getGitHubRepoPath } from '../../lib/repositoryIdentity.ts'
import type { GitHubRepository } from '../../schemas/github.schema.ts'

interface RepoStructuredDataProps {
  repo: GitHubRepository
}

export default function RepoStructuredData({ repo }: RepoStructuredDataProps) {
  const canonicalUrl = `${BASE_URL}/${getGitHubRepoPath(repo.owner.login, repo.name)}`
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: getRepoBreadcrumbs(repo).map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }

  const softwareSourceCode = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: repo.name,
    url: canonicalUrl,
    codeRepository: repo.html_url,
    ...(repo.description ? { description: repo.description } : {}),
    ...(repo.language ? { programmingLanguage: repo.language } : {}),
    ...(repo.created_at ? { dateCreated: repo.created_at } : {}),
    ...(repo.pushed_at ? { dateModified: repo.pushed_at } : {}),
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
    ...(repo.license?.url ? { license: repo.license.url } : {}),
    ...(repo.topics?.length ? { keywords: repo.topics.join(', ') } : {}),
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
      <script dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} type="application/ld+json" />
      <script dangerouslySetInnerHTML={{ __html: serializeJsonLd(softwareSourceCode) }} type="application/ld+json" />
      {organization ? <script dangerouslySetInnerHTML={{ __html: serializeJsonLd(organization) }} type="application/ld+json" /> : null}
    </>
  )
}
