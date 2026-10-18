import type { PluginSource } from '../app/types/plugin.type.ts'
import { getGitHubBlobUrl } from './repositoryIdentity.ts'

const GITHUB_REPO_PATH_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const GIT_SUFFIX_PATTERN = /\.git$/i
const PARENT_DIR_PATTERN = /(?:^|\/)\.\.(?:\/|$)/
const NEWLINE_PATTERN = /[\r\n]/
const LEADING_RELATIVE_PATTERN = /^(?:\.\/)+/
const TRAILING_SLASHES_PATTERN = /\/+$/
const EXACT_DOT_PATTERN = /^\.$/

function isValidPathSegment(segment?: string): boolean {
  return Boolean(segment && segment !== '.' && segment !== '..')
}

function normalizeGitHubRepository(value: string): string | null {
  if (!GITHUB_REPO_PATH_PATTERN.test(value)) return null
  const [owner, repo] = value.split('/')
  const repoName = repo.replace(GIT_SUFFIX_PATTERN, '')
  if (!(isValidPathSegment(owner) && isValidPathSegment(repoName))) {
    return null
  }
  return `${owner}/${repoName}`
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

    return normalizeGitHubRepository(`${owner}/${repo}`)
  } catch {
    return null
  }
}

function normalizeRelativePath(path: string): string | null {
  if (path.startsWith('/') || path.includes('\\') || PARENT_DIR_PATTERN.test(path) || NEWLINE_PATTERN.test(path)) {
    return null
  }
  return path.replace(LEADING_RELATIVE_PATTERN, '').replace(TRAILING_SLASHES_PATTERN, '').replace(EXACT_DOT_PATTERN, '')
}

function joinPluginPath(root: string, file: string): string | null {
  const normalizedRoot = normalizeRelativePath(root)
  const normalizedFile = normalizeRelativePath(file)
  if (normalizedRoot === null || !normalizedFile) return null
  return normalizedRoot ? `${normalizedRoot}/${normalizedFile}` : normalizedFile
}

interface PluginSourceTarget {
  repo: string | null
  ref?: string
  pluginRoot: string
}

function resolvePluginRef(source: { sha?: string; ref?: string; branch?: string; commit?: string }): string {
  return source.sha ?? source.ref ?? source.branch ?? source.commit ?? 'HEAD'
}

function resolveStringSource(source: string, marketplaceRepo: string, marketplaceDefaultBranch?: string): PluginSourceTarget | null {
  if (source.startsWith('github:')) {
    return {
      repo: getGitHubRepository(source.slice('github:'.length)),
      ref: 'HEAD',
      pluginRoot: '',
    }
  }

  if (source === '.' || source.startsWith('./')) {
    return {
      repo: marketplaceRepo,
      ref: marketplaceDefaultBranch,
      pluginRoot: source,
    }
  }

  return null
}

function resolveObjectSource(source: PluginSource): PluginSourceTarget | null {
  if (source.source === 'github') {
    return {
      repo: getGitHubRepository(source.repo ?? source.url),
      ref: resolvePluginRef(source),
      pluginRoot: source.path ?? '',
    }
  }

  if (source.source === 'git-subdir') {
    if (!source.path) return null
    return {
      repo: getGitHubRepository(source.url ?? source.repo),
      ref: resolvePluginRef(source),
      pluginRoot: source.path,
    }
  }

  return null
}

function resolvePluginSourceTarget(
  source: string | PluginSource | undefined,
  marketplaceRepo: string,
  marketplaceDefaultBranch?: string
): PluginSourceTarget | null {
  if (typeof source === 'string') {
    return resolveStringSource(source, marketplaceRepo, marketplaceDefaultBranch)
  }

  if (source && typeof source === 'object') {
    return resolveObjectSource(source)
  }

  return null
}

export function getPluginComponentFileUrl(
  source: string | PluginSource | undefined,
  marketplaceRepo: string,
  marketplaceDefaultBranch: string | undefined,
  file: string
): string | null {
  const target = resolvePluginSourceTarget(source, marketplaceRepo, marketplaceDefaultBranch)
  if (!(target?.repo && target.ref)) return null

  const path = joinPluginPath(target.pluginRoot, file)
  if (!path) return null

  return getGitHubBlobUrl(target.repo, target.ref, path)
}
