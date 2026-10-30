/** biome-ignore-all lint/style/useNamingConvention: schema.org node types are PascalCase. */
import type { GitHubRepository } from '../schemas/github.schema.ts'
import { getRepoBreadcrumbs } from './breadcrumbs.ts'
import { BASE_URL } from './constants.ts'
import { getGitHubRepoPath } from './repositoryIdentity.ts'

/** GitHub reports owners as User or Organization; an unrecorded type stays untyped rather than guessed. */
const AUTHOR_TYPES: Record<string, 'Organization' | 'Person'> = { Organization: 'Organization', User: 'Person' }

export function getRepoStructuredData(repo: GitHubRepository): Record<string, unknown>[] {
  const canonicalUrl = `${BASE_URL}/${getGitHubRepoPath(repo.owner.login, repo.name)}`
  const authorType = repo.owner.type === null ? undefined : AUTHOR_TYPES[repo.owner.type]

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
    author: {
      ...(authorType ? { '@type': authorType } : {}),
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
      : undefined

  return [breadcrumb, softwareSourceCode, ...(organization ? [organization] : [])]
}
