import { describe, expect, it } from 'vitest'
import {
  isValidGitHubOwner,
  isValidGitHubRepositoryName,
  parseGitHubOwnerUrl,
  parseGitHubRepository,
  parseGitHubRepositoryUrl,
} from './identifiers.js'

describe('GitHub identifiers', () => {
  it.each(['acme', 'acme-co', 'A1'])('accepts valid owners: %s', (owner) => {
    expect(isValidGitHubOwner(owner)).toBe(true)
  })

  it.each(['.acme', 'acme_org', 'acme.org', '-acme', 'acme-', 'a'.repeat(40)])('rejects invalid owners: %s', (owner) => {
    expect(isValidGitHubOwner(owner)).toBe(false)
  })

  it.each(['repo', '.github_tools.v2', 'repo-name', 'repo_name'])('accepts valid repository names: %s', (name) => {
    expect(isValidGitHubRepositoryName(name)).toBe(true)
  })

  it.each(['.', '..', 'owner/repo', 'bad repo', 'a'.repeat(101)])('rejects invalid repository names: %s', (name) => {
    expect(isValidGitHubRepositoryName(name)).toBe(false)
  })

  it('parses owner/repository using the shared owner and repository-name contract', () => {
    expect(parseGitHubRepository('acme-co/.github_tools.v2')).toEqual(['acme-co', '.github_tools.v2'])
    expect(parseGitHubRepository('acme_org/repo')).toBeUndefined()
    expect(parseGitHubRepository('acme/repo/extra')).toBeUndefined()
  })

  it('parses canonical GitHub URLs without accepting alternate URL shapes', () => {
    expect(parseGitHubOwnerUrl('https://github.com/acme-co')).toBe('acme-co')
    expect(parseGitHubOwnerUrl('https://github.com/acme_org')).toBeUndefined()
    expect(parseGitHubOwnerUrl('https://github.com/acme-co/')).toBeUndefined()

    expect(parseGitHubRepositoryUrl('https://github.com/acme-co/repo')).toEqual({ owner: 'acme-co', repo: 'repo' })
    expect(parseGitHubRepositoryUrl('https://github.com/acme_org/repo')).toBeUndefined()
    expect(parseGitHubRepositoryUrl('https://github.com/acme-co/repo/extra')).toBeUndefined()
    expect(parseGitHubRepositoryUrl('http://github.com/acme-co/repo')).toBeUndefined()
  })
})
