import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { components } from '@octokit/openapi-types'
import { isValidGitBranch, isValidGitHubOwner, isValidGitHubRepositoryName, isValidGitSha } from '../github/identifiers.js'
import { buildRepoDetailsShards, buildSearchIndex, type CatalogRecordInput } from '../output/splitCatalog.js'
import { throwIfShutdown } from '../shutdown.js'

// Bound Git Trees requests. The canonical repos.json blob may already exceed
// this budget; those individual legacy blobs are sent alone.
const MAX_TREE_REQUEST_BYTES = 4 * 1024 * 1024

export type GitBranchHead = { sha: string; treeSha: string }

export type GitSnapshotFiles = {
  readme: string
  catalogReleaseJson?: string
  reposJson?: string
  statsJson?: string
  markdownPathsJson?: string
}

export type UploadedReleaseAsset = {
  downloadUrl: string
  sha256: string
}

export interface GitHubGit {
  getBranchHead(): Promise<GitBranchHead>
  createTree(baseTreeSha: string, files: GitSnapshotFiles): Promise<string>
  createCommit(treeSha: string, parentSha: string, message: string): Promise<string>
  updateBranch(sha: string): Promise<void>
  isCommitReachable(pendingSha: string): Promise<boolean>
  uploadReleaseAsset?(tagName: string, assetName: string, filePath: string): Promise<UploadedReleaseAsset>
}

export class GitHubGitError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'GitHubGitError'
  }
}

export class GitHubGitHttpError extends GitHubGitError {
  constructor(status: number) {
    super(`GitHub Git API returned HTTP ${status}`, status)
    this.name = 'GitHubGitHttpError'
  }
}

export class GitHubGitConflictError extends GitHubGitHttpError {
  constructor(status: 409 | 422) {
    super(status)
    this.name = 'GitHubGitConflictError'
  }
}

export class GitHubGitResponseError extends GitHubGitError {
  constructor() {
    super('Invalid GitHub Git API response')
    this.name = 'GitHubGitResponseError'
  }
}

export class GitHubGitTimeoutError extends GitHubGitError {
  constructor() {
    super('GitHub Git API request aborted or timed out')
    this.name = 'GitHubGitTimeoutError'
  }
}

export type GitHubGitOptions = {
  token: string
  owner: string
  repo: string
  branch: string
  fetch?: typeof fetch
  signal?: AbortSignal
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function sha(value: unknown): string {
  if (!isValidGitSha(value)) throw new GitHubGitResponseError()
  return value
}

function inputSha(value: unknown): string {
  if (!isValidGitSha(value)) throw new GitHubGitError('Valid Git SHA is required')
  return value
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

async function refConflictStatus(response: Response): Promise<409 | 422 | null> {
  if (response.status === 409) return 409
  if (response.status !== 422) return null
  try {
    const payload = (await response.json()) as unknown
    if (record(payload) && typeof payload.message === 'string' && payload.message.trim().toLowerCase() === 'update is not a fast forward') {
      return 422
    }
  } catch {
    // A malformed validation response is still a confirmed HTTP rejection, not an ambiguous PATCH.
  }
  return null
}

export class GitHubGitClient implements GitHubGit {
  private readonly owner: string
  private readonly repo: string
  private readonly url: string
  private readonly compareUrl: string
  private readonly compareHead: string
  private readonly releasesUrl: string
  private readonly token: string
  private readonly transport: typeof fetch
  private readonly signal?: AbortSignal

  constructor(options: GitHubGitOptions) {
    for (const field of ['token', 'owner', 'repo', 'branch'] as const) {
      if (typeof options?.[field] !== 'string' || !options[field].trim()) {
        throw new GitHubGitError(`GitHub Git ${field} is required`)
      }
    }
    if (!isValidGitHubOwner(options.owner)) {
      throw new GitHubGitError('Invalid GitHub Git owner')
    }
    if (!isValidGitHubRepositoryName(options.repo)) {
      throw new GitHubGitError('Invalid GitHub Git repo')
    }
    if (!isValidGitBranch(options.branch)) {
      throw new GitHubGitError('Invalid GitHub Git branch')
    }
    this.owner = options.owner
    this.repo = options.repo
    this.token = options.token
    this.transport = options.fetch ?? globalThis.fetch
    this.signal = options.signal
    const repositoryUrl = `https://api.github.com/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}`
    const branch = options.branch.split('/').map(encodeURIComponent).join('/')
    this.url = `${repositoryUrl}/git`
    this.compareUrl = `${repositoryUrl}/compare`
    this.compareHead = encodeURIComponent(options.branch)
    this.releasesUrl = `${repositoryUrl}/releases`
    this.ref = `heads/${branch}`
  }

  private readonly ref: string

  private async readRefSha(): Promise<string> {
    const response = await this.request(`/ref/${this.ref}`)
    if (!record(response) || !record(response.object) || response.object.type !== 'commit') throw new GitHubGitResponseError()
    const ref = response as Pick<components['schemas']['git-ref'], 'object'>
    return sha(ref.object.sha)
  }

  async getBranchHead(): Promise<GitBranchHead> {
    const headSha = await this.readRefSha()
    const commit = await this.readCommit(headSha)
    return { sha: headSha, treeSha: commit.treeSha }
  }

  async createTree(baseTreeSha: string, files: GitSnapshotFiles): Promise<string> {
    inputSha(baseTreeSha)
    if (
      !record(files) ||
      typeof files.readme !== 'string' ||
      (!files.catalogReleaseJson &&
        (typeof files.reposJson !== 'string' || typeof files.statsJson !== 'string' || typeof files.markdownPathsJson !== 'string'))
    ) {
      throw new GitHubGitError('All four snapshot contents must be strings')
    }
    const entries: { path: string; mode: '100644'; type: 'blob'; content: string }[] = [
      { path: 'README.md', mode: '100644', type: 'blob', content: files.readme },
    ]

    if (typeof files.catalogReleaseJson === 'string') {
      entries.push({
        path: 'awesomeclaudeplugins.com/ui/catalog-release.json',
        mode: '100644',
        type: 'blob',
        content: files.catalogReleaseJson,
      })
    } else if (typeof files.reposJson === 'string') {
      // Publish all legacy snapshot parts in intermediate trees without moving the ref.
      // Only a fully constructed final tree can be committed atomically.
      let repositories: CatalogRecordInput[]
      try {
        repositories = JSON.parse(files.reposJson) as CatalogRecordInput[]
        if (!Array.isArray(repositories)) throw new Error('Invalid catalog')
      } catch {
        throw new GitHubGitError('Invalid repository snapshot JSON')
      }
      const dataPath = 'awesomeclaudeplugins.com/ui/src/data'
      const details = buildRepoDetailsShards(repositories)
      entries.push(
        { path: `${dataPath}/repos.json`, mode: '100644', type: 'blob', content: files.reposJson },
        { path: `${dataPath}/search-index.json`, mode: '100644', type: 'blob', content: buildSearchIndex(repositories, files.reposJson) },
        ...Object.entries(details).map(([name, content]) => ({
          path: `${dataPath}/repo-details/${name}`,
          mode: '100644' as const,
          type: 'blob' as const,
          content,
        })),
      )
      if (typeof files.statsJson === 'string') {
        entries.push({ path: `${dataPath}/stats.json`, mode: '100644', type: 'blob', content: files.statsJson })
      }
      if (typeof files.markdownPathsJson === 'string') {
        entries.push({ path: `${dataPath}/markdown-paths.json`, mode: '100644', type: 'blob', content: files.markdownPathsJson })
      }
    }

    // Measure escaped JSON bytes, including entry separators and base-tree SHA.
    // Single blobs larger than the budget still require their own request.
    const overhead = Buffer.byteLength(JSON.stringify({ base_tree: baseTreeSha, tree: [] }))
    let batch: typeof entries = []
    let batchSize = overhead
    let currentTreeSha = baseTreeSha
    const publishBatch = async () => {
      if (batch.length === 0) return
      const response = await this.request('/trees', 'POST', { base_tree: currentTreeSha, tree: batch })
      if (!record(response) || response.truncated === true) throw new GitHubGitResponseError()
      currentTreeSha = sha((response as Pick<components['schemas']['git-tree'], 'sha'>).sha)
      batch = []
      batchSize = overhead
    }
    for (const entry of entries) {
      const entryBytes = Buffer.byteLength(JSON.stringify(entry)) + 1
      if (batch.length > 0 && batchSize + entryBytes > MAX_TREE_REQUEST_BYTES) await publishBatch()
      batch.push(entry)
      batchSize += entryBytes
    }
    await publishBatch()
    return currentTreeSha
  }

  async createCommit(treeSha: string, parentSha: string, message: string): Promise<string> {
    inputSha(treeSha)
    inputSha(parentSha)
    if (!nonempty(message) || !message.trim()) throw new GitHubGitError('Commit message is required')
    const response = await this.request('/commits', 'POST', { tree: treeSha, parents: [parentSha], message })
    if (!record(response)) throw new GitHubGitResponseError()
    return sha((response as Pick<components['schemas']['git-commit'], 'sha'>).sha)
  }

  async updateBranch(newSha: string): Promise<void> {
    inputSha(newSha)
    const response = await this.request(`/refs/${this.ref}`, 'PATCH', { sha: newSha, force: false })
    if (!record(response) || !record(response.object)) throw new GitHubGitResponseError()
    const ref = response as Pick<components['schemas']['git-ref'], 'object'>
    if (sha(ref.object.sha) !== newSha) throw new GitHubGitResponseError()
  }

  async isCommitReachable(pendingSha: string): Promise<boolean> {
    inputSha(pendingSha)
    const response = await this.request(`/${encodeURIComponent(pendingSha)}...${this.compareHead}`, 'GET', undefined, this.compareUrl)
    if (!record(response) || typeof response.status !== 'string') throw new GitHubGitResponseError()
    const comparison = response as Pick<components['schemas']['commit-comparison'], 'status'>
    if (comparison.status === 'ahead' || comparison.status === 'identical') return true
    if (comparison.status === 'behind' || comparison.status === 'diverged') return false
    throw new GitHubGitResponseError()
  }

  async uploadReleaseAsset(tagName: string, assetName: string, filePath: string): Promise<UploadedReleaseAsset> {
    throwIfShutdown(this.signal)
    let releaseId: number | undefined
    let uploadUrlTemplate: string | undefined
    try {
      const existing = (await this.request(`/tags/${encodeURIComponent(tagName)}`, 'GET', undefined, this.releasesUrl)) as Record<
        string,
        unknown
      >
      if (record(existing) && typeof existing.id === 'number' && typeof existing.upload_url === 'string') {
        releaseId = existing.id
        uploadUrlTemplate = existing.upload_url
      }
    } catch (error) {
      if (error instanceof GitHubGitHttpError && error.status === 404) {
        const created = (await this.request(
          '',
          'POST',
          {
            tag_name: tagName,
            name: tagName,
            draft: false,
            prerelease: false,
          },
          this.releasesUrl,
        )) as Record<string, unknown>
        if (record(created) && typeof created.id === 'number' && typeof created.upload_url === 'string') {
          releaseId = created.id
          uploadUrlTemplate = created.upload_url
        }
      } else {
        throw error
      }
    }

    if (!releaseId || !uploadUrlTemplate) {
      throw new GitHubGitResponseError()
    }

    try {
      const assets = (await this.request(`/${releaseId}/assets`, 'GET', undefined, this.releasesUrl)) as unknown[]
      if (Array.isArray(assets)) {
        const existingAsset = assets.find((a): a is Record<string, unknown> => record(a) && a.name === assetName)
        if (existingAsset && typeof existingAsset.id === 'number') {
          await this.request(`/assets/${existingAsset.id}`, 'DELETE', undefined, this.releasesUrl)
        }
      }
    } catch {
      // Continue to attempt upload
    }

    const uploadUrl = `${uploadUrlTemplate.replace(/\{.*?\}$/, '')}?name=${encodeURIComponent(assetName)}`
    const fileBytes = readFileSync(filePath)
    const fileSha = createHash('sha256').update(fileBytes).digest('hex')

    const timeoutSignal = AbortSignal.timeout(120_000)
    let response: Response
    try {
      response = await this.transport(uploadUrl, {
        method: 'POST',
        signal: this.signal ? AbortSignal.any([this.signal, timeoutSignal]) : timeoutSignal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(fileBytes.length),
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: fileBytes,
      })
    } catch (error) {
      throwIfShutdown(this.signal)
      if (isAbort(error)) throw new GitHubGitTimeoutError()
      throw new GitHubGitError('GitHub Git API network request failed')
    }

    if (!response.ok) {
      throw new GitHubGitHttpError(response.status)
    }

    const uploaded = (await response.json()) as Record<string, unknown>
    const downloadUrl =
      typeof uploaded.browser_download_url === 'string'
        ? uploaded.browser_download_url
        : `https://github.com/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/releases/download/${encodeURIComponent(tagName)}/${encodeURIComponent(assetName)}`

    return { downloadUrl, sha256: fileSha }
  }

  private async readCommit(commitSha: string): Promise<{ treeSha: string; parents: string[] }> {
    const response = await this.request(`/commits/${encodeURIComponent(commitSha)}`)
    if (!record(response) || response.sha !== commitSha || !record(response.tree) || !Array.isArray(response.parents)) {
      throw new GitHubGitResponseError()
    }
    const commit = response as Pick<components['schemas']['git-commit'], 'sha' | 'tree' | 'parents'>
    return {
      treeSha: sha(commit.tree.sha),
      parents: commit.parents.map((parent: unknown) => {
        if (!record(parent)) throw new GitHubGitResponseError()
        return sha(parent.sha)
      }),
    }
  }

  private async request(path: string, method = 'GET', body?: unknown, baseUrl = this.url): Promise<unknown> {
    throwIfShutdown(this.signal)
    let response: Response
    const timeoutSignal = AbortSignal.timeout(30_000)
    try {
      response = await this.transport(`${baseUrl}${path}`, {
        method,
        signal: this.signal ? AbortSignal.any([this.signal, timeoutSignal]) : timeoutSignal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (error) {
      throwIfShutdown(this.signal)
      if (isAbort(error)) throw new GitHubGitTimeoutError()
      throw new GitHubGitError('GitHub Git API network request failed')
    }
    throwIfShutdown(this.signal)
    if (!response.ok) {
      const conflictStatus = method === 'PATCH' ? await refConflictStatus(response) : null
      throwIfShutdown(this.signal)
      if (conflictStatus !== null) throw new GitHubGitConflictError(conflictStatus)
      throw new GitHubGitHttpError(response.status)
    }
    try {
      const result = (await response.json()) as unknown
      throwIfShutdown(this.signal)
      return result
    } catch (error) {
      throwIfShutdown(this.signal)
      if (isAbort(error)) throw new GitHubGitTimeoutError()
      throw new GitHubGitResponseError()
    }
  }
}
