export type GitBranchHead = { sha: string; treeSha: string }

export type GitSnapshotFiles = {
  readme: string
  reposJson: string
  statsJson: string
}

export interface GitHubGit {
  getBranchHead(): Promise<GitBranchHead>
  createTree(baseTreeSha: string, files: GitSnapshotFiles): Promise<string>
  createCommit(treeSha: string, parentSha: string, message: string): Promise<string>
  updateBranch(sha: string): Promise<void>
  isCommitReachable(pendingSha: string, maxCommits?: number): Promise<boolean>
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

export class GitHubGitHistoryError extends GitHubGitError {
  constructor() {
    super('Git commit ancestry is indeterminate within the traversal limit')
    this.name = 'GitHubGitHistoryError'
  }
}

export type GitHubGitOptions = {
  token: string
  owner: string
  repo: string
  branch: string
  fetch?: typeof fetch
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

function sha(value: unknown): string {
  if (typeof value !== 'string' || !shaPattern.test(value)) throw new GitHubGitResponseError()
  return value
}

function inputSha(value: unknown): string {
  if (typeof value !== 'string' || !shaPattern.test(value)) throw new GitHubGitError('Valid Git SHA is required')
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
  private readonly url: string
  private readonly token: string
  private readonly transport: typeof fetch

  constructor(options: GitHubGitOptions) {
    for (const field of ['token', 'owner', 'repo', 'branch'] as const) {
      if (typeof options?.[field] !== 'string' || !options[field].trim()) {
        throw new GitHubGitError(`GitHub Git ${field} is required`)
      }
    }
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(options.owner)) {
      throw new GitHubGitError('Invalid GitHub Git owner')
    }
    if (options.repo.length > 100 || options.repo === '.' || options.repo === '..' || !/^[A-Za-z0-9._-]+$/.test(options.repo)) {
      throw new GitHubGitError('Invalid GitHub Git repo')
    }
    if (
      options.branch === '@' ||
      options.branch.includes('@{') ||
      options.branch
        .split('/')
        .some(
          (part) =>
            !part ||
            part.startsWith('.') ||
            part.endsWith('.') ||
            part.endsWith('.lock') ||
            part.includes('..') ||
            /[\\~^:?*[\]\s]/u.test(part),
        )
    ) {
      throw new GitHubGitError('Invalid GitHub Git branch')
    }
    this.token = options.token
    this.transport = options.fetch ?? globalThis.fetch
    const branch = options.branch.split('/').map(encodeURIComponent).join('/')
    this.url = `https://api.github.com/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}/git`
    this.ref = `heads/${branch}`
  }

  private readonly ref: string

  private async readRefSha(): Promise<string> {
    const response = await this.request(`/ref/${this.ref}`)
    if (!record(response) || !record(response.object) || response.object.type !== 'commit') throw new GitHubGitResponseError()
    return sha(response.object.sha)
  }

  async getBranchHead(): Promise<GitBranchHead> {
    const headSha = await this.readRefSha()
    const commit = await this.readCommit(headSha)
    return { sha: headSha, treeSha: commit.treeSha }
  }

  async createTree(baseTreeSha: string, files: GitSnapshotFiles): Promise<string> {
    inputSha(baseTreeSha)
    if (!record(files) || typeof files.readme !== 'string' || typeof files.reposJson !== 'string' || typeof files.statsJson !== 'string') {
      throw new GitHubGitError('All three snapshot contents must be strings')
    }
    const response = await this.request('/trees', 'POST', {
      base_tree: baseTreeSha,
      tree: [
        { path: 'README.md', mode: '100644', type: 'blob', content: files.readme },
        { path: 'ui/src/data/repos.json', mode: '100644', type: 'blob', content: files.reposJson },
        { path: 'ui/src/data/stats.json', mode: '100644', type: 'blob', content: files.statsJson },
      ],
    })
    if (!record(response)) throw new GitHubGitResponseError()
    return sha(response.sha)
  }

  async createCommit(treeSha: string, parentSha: string, message: string): Promise<string> {
    inputSha(treeSha)
    inputSha(parentSha)
    if (!nonempty(message) || !message.trim()) throw new GitHubGitError('Commit message is required')
    const response = await this.request('/commits', 'POST', { tree: treeSha, parents: [parentSha], message })
    if (!record(response)) throw new GitHubGitResponseError()
    return sha(response.sha)
  }

  async updateBranch(newSha: string): Promise<void> {
    inputSha(newSha)
    const response = await this.request(`/refs/${this.ref}`, 'PATCH', { sha: newSha, force: false })
    if (!record(response) || !record(response.object) || sha(response.object.sha) !== newSha) throw new GitHubGitResponseError()
  }

  async isCommitReachable(pendingSha: string, maxCommits = 256): Promise<boolean> {
    if (!Number.isSafeInteger(maxCommits) || maxCommits < 1 || maxCommits > 2048) {
      throw new GitHubGitError('maxCommits must be an integer from 1 to 2048')
    }
    inputSha(pendingSha)
    const queue = [await this.readRefSha()]
    const visited = new Set<string>()
    for (let index = 0; index < queue.length; index++) {
      const currentSha = queue[index]
      if (currentSha === pendingSha) return true
      if (visited.has(currentSha)) continue
      if (visited.size >= maxCommits) throw new GitHubGitHistoryError()
      visited.add(currentSha)
      const { parents } = await this.readCommit(currentSha)
      queue.push(...parents)
    }
    return false
  }

  private async readCommit(commitSha: string): Promise<{ treeSha: string; parents: string[] }> {
    const response = await this.request(`/commits/${encodeURIComponent(commitSha)}`)
    if (!record(response) || response.sha !== commitSha || !record(response.tree) || !Array.isArray(response.parents)) {
      throw new GitHubGitResponseError()
    }
    return {
      treeSha: sha(response.tree.sha),
      parents: response.parents.map((parent: unknown) => {
        if (!record(parent)) throw new GitHubGitResponseError()
        return sha(parent.sha)
      }),
    }
  }

  private async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    let response: Response
    try {
      response = await this.transport(`${this.url}${path}`, {
        method,
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (error) {
      if (isAbort(error)) throw new GitHubGitTimeoutError()
      throw new GitHubGitError('GitHub Git API network request failed')
    }
    if (!response.ok) {
      const conflictStatus = method === 'PATCH' ? await refConflictStatus(response) : null
      if (conflictStatus !== null) throw new GitHubGitConflictError(conflictStatus)
      throw new GitHubGitHttpError(response.status)
    }
    try {
      return (await response.json()) as unknown
    } catch (error) {
      if (isAbort(error)) throw new GitHubGitTimeoutError()
      throw new GitHubGitResponseError()
    }
  }
}
