import { BASE_URL } from './constants.ts'
import { getGitHubRepoPath } from './repositoryIdentity.ts'

export type Breadcrumb = {
  name: string
  url: string
}

export function getRepoBreadcrumbs(repo: { name: string; owner: { login: string } }): Breadcrumb[] {
  return [
    { name: 'Home', url: BASE_URL },
    { name: repo.name, url: `${BASE_URL}/${getGitHubRepoPath(repo.owner.login, repo.name)}` },
  ]
}

export function getStatsBreadcrumbs(): Breadcrumb[] {
  return [
    { name: 'Home', url: BASE_URL },
    { name: 'Statistics', url: `${BASE_URL}/stats` },
  ]
}

export function getAboutBreadcrumbs(): Breadcrumb[] {
  return [
    { name: 'Home', url: BASE_URL },
    { name: 'About', url: `${BASE_URL}/about` },
  ]
}
