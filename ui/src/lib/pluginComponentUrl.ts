import type { PluginSource } from '../app/types/plugin.type.ts'
import { getGitHubBlobUrl } from './repositoryIdentity.ts'

const GITHUB_REPO_PATH_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

function normalizeGitHubRepository(value: string): string | null {
  if (!GITHUB_REPO_PATH_PATTERN.test(value)) return null
  const [owner, repo] = value.split('/')
  const repoName = repo.replace(/\.git$/i, '')
  if (
    !owner ||
    !repoName ||
    owner === '.' ||
    owner === '..' ||
    repoName === '.' ||
    repoName === '..'
  ) return null
  return owner + '/' + repoName
}

function getGitHubRepository(value?: string): string | null {
  if (!value) return null
  const repository = normalizeGitHubRepository(value)
  if (repository) return repository

  try {
    const url = new URL(value)
    const [owner, repo, ...rest] = url.pathname.split('/').filter(Boolean)
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.hostname.toLowerCase() !== 'github.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !owner ||
      !repo ||
      rest.length > 0
    ) {
      return null
    }

    return normalizeGitHubRepository(owner + '/' + repo)
  } catch {
    return null
  }
}

function normalizeRelativePath(path: string): string | null {
  if (path.startsWith('/') || path.includes('\\') || /(?:^|\/)\.\.(?:\/|$)/.test(path) || /[\r\n]/.test(path)) return null
  return path.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '').replace(/^\.$/, '')
}

function joinPluginPath(root: string, file: string): string | null {
  const normalizedRoot = normalizeRelativePath(root)
  const normalizedFile = normalizeRelativePath(file)
  if (normalizedRoot === null || !normalizedFile) return null
  return normalizedRoot ? normalizedRoot + '/' + normalizedFile : normalizedFile
}

export function getPluginComponentFileUrl(
  source: string | PluginSource | undefined,
  marketplaceRepo: string,
  marketplaceDefaultBranch: string | undefined,
  file: string,
): string | null {
  let repo: string | null
  let ref: string | undefined
  let pluginRoot: string

  if (typeof source === 'string') {
    if (source.startsWith('github:')) {
      repo = getGitHubRepository(source.slice('github:'.length))
      ref = 'HEAD'
      pluginRoot = ''
    } else if (source === '.' || source.startsWith('./')) {
      repo = marketplaceRepo
      ref = marketplaceDefaultBranch
      pluginRoot = source
    } else {
      return null
    }
  } else if (source?.source === 'github') {
    repo = getGitHubRepository(source.repo ?? source.url)
    ref = source.sha ?? source.ref ?? source.branch ?? source.commit ?? 'HEAD'
    pluginRoot = source.path ?? ''
  } else if (source?.source === 'git-subdir') {
    repo = getGitHubRepository(source.url ?? source.repo)
    ref = source.sha ?? source.ref ?? source.branch ?? source.commit ?? 'HEAD'
    if (!source.path) return null
    pluginRoot = source.path
  } else {
    return null
  }

  const path = joinPluginPath(pluginRoot, file)
  return repo && ref && path ? getGitHubBlobUrl(repo, ref, path) : null
}
