import { describe, expect, it, vi } from 'vitest'
import {
  GitHubGitClient,
  GitHubGitConflictError,
  GitHubGitHistoryError,
  GitHubGitHttpError,
  GitHubGitResponseError,
  GitHubGitTimeoutError,
} from './githubGit.js'

const baseSha = 'a'.repeat(40)
const baseTree = 'b'.repeat(40)
const treeSha = 'c'.repeat(40)
const pendingSha = 'd'.repeat(40)
const laterSha = 'e'.repeat(40)
const rootSha = 'f'.repeat(40)
const files = { readme: '# Catalog\n', reposJson: '[{"id":1}]\n', statsJson: '[{"id":1}]\n' }

function ref(sha: string): Response {
  return Response.json({ ref: 'refs/heads/main', object: { type: 'commit', sha, url: 'https://api.github.com/git/commits/x' } })
}

function commit(sha: string, tree: string, parents: string[] = []): Response {
  return Response.json({
    sha,
    tree: { sha: tree, url: 'https://api.github.com/git/trees/x' },
    parents: parents.map((parent) => ({ sha: parent })),
  })
}

function mockClient(responses: Array<Response | Error>, config: Partial<ConstructorParameters<typeof GitHubGitClient>[0]> = {}) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []
  const client = new GitHubGitClient({
    token: 'private-publish-token',
    owner: 'acme',
    repo: 'catalog',
    branch: 'main',
    ...config,
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init })
      const next = responses.shift()
      if (!next) throw new Error('Unexpected mock request')
      if (next instanceof Error) throw next
      return next
    }) as typeof fetch,
  })
  return { client, requests }
}

function payload(request: { init: RequestInit | undefined }): unknown {
  return JSON.parse(String(request.init?.body)) as unknown
}

describe('GitHubGitClient', () => {
  it('creates exactly three content blobs on the base tree and advances the ref without force', async () => {
    const { client, requests } = mockClient([
      ref(baseSha),
      commit(baseSha, baseTree, [rootSha]),
      Response.json({ sha: treeSha }),
      commit(pendingSha, treeSha, [baseSha]),
      ref(pendingSha),
    ])
    const head = await client.getBranchHead()
    expect(head).toEqual({ sha: baseSha, treeSha: baseTree })
    const tree = await client.createTree(head.treeSha, files)
    const pending = await client.createCommit(tree, head.sha, 'Update catalog')
    await client.updateBranch(pending)
    expect(tree).toBe(treeSha)
    expect(pending).toBe(pendingSha)

    expect(requests.map(({ url, init }) => [init?.method ?? 'GET', url])).toEqual([
      ['GET', 'https://api.github.com/repos/acme/catalog/git/ref/heads/main'],
      ['GET', `https://api.github.com/repos/acme/catalog/git/commits/${baseSha}`],
      ['POST', 'https://api.github.com/repos/acme/catalog/git/trees'],
      ['POST', 'https://api.github.com/repos/acme/catalog/git/commits'],
      ['PATCH', 'https://api.github.com/repos/acme/catalog/git/refs/heads/main'],
    ])
    expect(requests[0].init?.headers).toMatchObject({
      Authorization: 'Bearer private-publish-token',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    })
    expect(requests[2].init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(payload(requests[2])).toEqual({
      base_tree: baseTree,
      tree: [
        { path: 'README.md', mode: '100644', type: 'blob', content: '# Catalog\n' },
        { path: 'ui/src/data/repos.json', mode: '100644', type: 'blob', content: '[{"id":1}]\n' },
        { path: 'ui/src/data/stats.json', mode: '100644', type: 'blob', content: '[{"id":1}]\n' },
      ],
    })
    expect(payload(requests[3])).toEqual({ tree: treeSha, parents: [baseSha], message: 'Update catalog' })
    expect(payload(requests[4])).toEqual({ sha: pendingSha, force: false })
  })

  it('requires explicit publishing credentials and repository identity before any request', () => {
    for (const field of ['token', 'owner', 'repo', 'branch'] as const) {
      const values = { token: 'secret', owner: 'acme', repo: 'catalog', branch: 'main', [field]: '  ' }
      expect(() => new GitHubGitClient(values)).toThrow(`GitHub Git ${field} is required`)
    }
  })

  it.each([
    '.',
    '..',
    '../other',
    'team/name',
    'one?two',
    'one#two',
    'user@host',
    'user:pass',
    'has space',
    'has\ttab',
    '%2e%2e',
    'one\\two',
  ])('rejects unsafe owner and repo segment %s without making an HTTP request', (segment) => {
    for (const field of ['owner', 'repo'] as const) {
      const transport = vi.fn()
      expect(
        () =>
          new GitHubGitClient({
            token: 'private-publish-token',
            owner: 'acme',
            repo: 'catalog',
            branch: 'main',
            [field]: segment,
            fetch: transport as unknown as typeof fetch,
          }),
      ).toThrow(`GitHub Git ${field}`)
      expect(transport).not.toHaveBeenCalled()
    }
  })

  it('accepts GitHub-safe repository and owner segments', async () => {
    const { client, requests } = mockClient([ref(baseSha), commit(baseSha, baseTree)], { owner: 'acme-co', repo: '.github_tools.v2' })
    await client.getBranchHead()
    expect(requests[0].url).toBe('https://api.github.com/repos/acme-co/.github_tools.v2/git/ref/heads/main')
  })

  it('encodes branch path components without dropping the slash', async () => {
    const { client, requests } = mockClient([ref(baseSha), commit(baseSha, baseTree)], { branch: 'release/v1+beta' })
    await client.getBranchHead()
    expect(requests[0].url).toBe('https://api.github.com/repos/acme/catalog/git/ref/heads/release/v1%2Bbeta')
  })

  it('rejects invalid branch refs instead of allowing path traversal', () => {
    expect(() => mockClient([], { branch: '../elsewhere' })).toThrow('branch')
    expect(() => mockClient([], { branch: 'release//bad' })).toThrow('branch')
  })

  it('rejects missing blob content before POST so every tree contains three string blobs', async () => {
    const { client, requests } = mockClient([])
    await expect(client.createTree(baseTree, { ...files, reposJson: undefined } as unknown as typeof files)).rejects.toThrow('snapshot')
    expect(requests).toHaveLength(0)
  })

  it('refuses to create a tree without a valid base tree SHA', async () => {
    const { client, requests } = mockClient([])
    await expect(client.createTree('', files)).rejects.toThrow('SHA')
    expect(requests).toHaveLength(0)
  })

  it('refuses to create a commit without a parent or message', async () => {
    const { client, requests } = mockClient([])
    await expect(client.createCommit(treeSha, '', 'Update catalog')).rejects.toThrow('SHA')
    await expect(client.createCommit(treeSha, baseSha, '')).rejects.toThrow('message')
    expect(requests).toHaveLength(0)
  })

  it.each([401, 403, 404, 422])('rejects HTTP %i with a typed status and never includes the token or response body', async (status) => {
    const { client, requests } = mockClient([Response.json({ message: 'private-publish-token sensitive response' }, { status })])
    const failure = await client.getBranchHead().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(GitHubGitHttpError)
    expect(failure).toMatchObject({ status })
    expect(String(failure)).not.toMatch(/private-publish-token|sensitive response/)
    expect(requests).toHaveLength(1)
  })

  it('exposes PATCH 409 as a ref conflict and never forces the ref', async () => {
    const { client, requests } = mockClient([Response.json({ message: 'Conflict' }, { status: 409 })])
    await expect(client.updateBranch(pendingSha)).rejects.toBeInstanceOf(GitHubGitConflictError)
    expect(payload(requests[0])).toEqual({ sha: pendingSha, force: false })
    expect(requests).toHaveLength(1)
  })

  it('recognizes GitHub non-fast-forward PATCH 422 as a retryable ref conflict', async () => {
    const { client, requests } = mockClient([Response.json({ message: 'Update is not a fast forward' }, { status: 422 })])
    await expect(client.updateBranch(pendingSha)).rejects.toBeInstanceOf(GitHubGitConflictError)
    expect(payload(requests[0])).toEqual({ sha: pendingSha, force: false })
    expect(requests).toHaveLength(1)
  })

  it('keeps other PATCH 422 responses as confirmed HTTP rejections without leaking the body', async () => {
    const { client } = mockClient([Response.json({ message: 'private-publish-token validation failed' }, { status: 422 })])
    const failure = await client.updateBranch(pendingSha).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(GitHubGitHttpError)
    expect(failure).not.toBeInstanceOf(GitHubGitConflictError)
    expect(failure).toMatchObject({ status: 422 })
    expect(String(failure)).not.toContain('private-publish-token')
  })

  it('does not confuse a failed tree creation with a ref conflict', async () => {
    const { client, requests } = mockClient([new Response('', { status: 422 })])
    const failure = await client.createTree(baseTree, files).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(GitHubGitHttpError)
    expect(failure).not.toBeInstanceOf(GitHubGitConflictError)
    expect(failure).toMatchObject({ status: 422 })
    expect(requests).toHaveLength(1)
  })

  it('stops before a ref update when commit creation fails after the tree was created', async () => {
    const { client, requests } = mockClient([Response.json({ sha: treeSha }), new Response('', { status: 403 })])
    expect(await client.createTree(baseTree, files)).toBe(treeSha)
    await expect(client.createCommit(treeSha, baseSha, 'Update catalog')).rejects.toMatchObject({ status: 403 })
    expect(requests.map((request) => request.init?.method)).toEqual(['POST', 'POST'])
  })

  it('treats an invalid PATCH response as indeterminate rather than confirmed publication', async () => {
    const { client } = mockClient([new Response('not JSON', { status: 200 })])
    await expect(client.updateBranch(pendingSha)).rejects.toBeInstanceOf(GitHubGitResponseError)
  })

  it('rejects a successful PATCH whose response points to a different commit', async () => {
    const { client } = mockClient([ref(laterSha)])
    await expect(client.updateBranch(pendingSha)).rejects.toBeInstanceOf(GitHubGitResponseError)
  })

  it('rejects malformed ref, commit, and tree JSON without reusing an unknown base', async () => {
    const badRef = mockClient([new Response('{', { status: 200 })])
    await expect(badRef.client.getBranchHead()).rejects.toBeInstanceOf(GitHubGitResponseError)
    const badCommit = mockClient([ref(baseSha), commit(laterSha, baseTree)])
    await expect(badCommit.client.getBranchHead()).rejects.toBeInstanceOf(GitHubGitResponseError)
    const badTree = mockClient([Response.json({ sha: null })])
    await expect(badTree.client.createTree(baseTree, files)).rejects.toBeInstanceOf(GitHubGitResponseError)
  })

  it('does not surface a transport exception that could include credentials', async () => {
    const { client } = mockClient([new Error('private-publish-token leaked from transport')])
    const failure = await client.getBranchHead().catch((error: unknown) => error)
    expect(String(failure)).not.toContain('private-publish-token')
    expect(failure).toHaveProperty('status', null)
  })

  it('sets a 30-second abort deadline on ref updates', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      const { client, requests } = mockClient([ref(pendingSha)])
      await client.updateBranch(pendingSha)
      expect(requests[0].init?.signal).toBeInstanceOf(AbortSignal)
      expect(timeout).toHaveBeenCalledWith(30_000)
    } finally {
      timeout.mockRestore()
    }
  })

  it('reports an aborted fetch as a typed timeout without exposing credentials', async () => {
    const { client } = mockClient([new DOMException('private-publish-token from transport', 'AbortError')])
    const failure = await client.updateBranch(pendingSha).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(GitHubGitTimeoutError)
    expect(failure).toHaveProperty('status', null)
    expect(String(failure)).not.toContain('private-publish-token')
  })

  it('reports an aborted response body as a typed timeout without exposing credentials', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new DOMException('private-publish-token from body', 'AbortError'))
      },
    })
    const { client } = mockClient([new Response(body, { status: 200 })])
    const failure = await client.updateBranch(pendingSha).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(GitHubGitTimeoutError)
    expect(String(failure)).not.toContain('private-publish-token')
  })

  it('finds a pending commit behind later commits without moving the ref', async () => {
    const { client, requests } = mockClient([ref(laterSha), commit(laterSha, treeSha, [pendingSha])])
    expect(await client.isCommitReachable(pendingSha)).toBe(true)
    expect(requests.map(({ init }) => init?.method ?? 'GET')).toEqual(['GET', 'GET'])
  })

  it('recognizes a pending parent even at the ancestor traversal limit', async () => {
    const { client } = mockClient([ref(laterSha), commit(laterSha, treeSha, [pendingSha])])
    expect(await client.isCommitReachable(pendingSha, 1)).toBe(true)
  })

  it('searches all parents of merge commits to find the pending commit', async () => {
    const { client, requests } = mockClient([ref(laterSha), commit(laterSha, treeSha, [rootSha, pendingSha]), commit(rootSha, baseTree)])
    expect(await client.isCommitReachable(pendingSha)).toBe(true)
    expect(requests.map(({ url }) => url)).toEqual([
      'https://api.github.com/repos/acme/catalog/git/ref/heads/main',
      `https://api.github.com/repos/acme/catalog/git/commits/${laterSha}`,
      `https://api.github.com/repos/acme/catalog/git/commits/${rootSha}`,
    ])
  })

  it('returns false only after reaching all roots of unrelated history', async () => {
    const { client } = mockClient([ref(laterSha), commit(laterSha, treeSha, [rootSha]), commit(rootSha, baseTree)])
    expect(await client.isCommitReachable(pendingSha)).toBe(false)
  })

  it('fails explicitly if the ancestor limit prevents a conclusive answer', async () => {
    const { client, requests } = mockClient([ref(laterSha), commit(laterSha, treeSha, [rootSha])])
    await expect(client.isCommitReachable(pendingSha, 1)).rejects.toBeInstanceOf(GitHubGitHistoryError)
    expect(requests).toHaveLength(2)
  })

  it('lets an operator inspect a pending commit past the automatic 256-commit horizon', async () => {
    const history = Array.from({ length: 258 }, (_, index) => (index + 1).toString(16).padStart(40, '0'))
    const { client, requests } = mockClient([
      ref(history[0]),
      ...history.slice(0, -1).map((current, index) => commit(current, treeSha, [history[index + 1]])),
    ])
    expect(await client.isCommitReachable(history.at(-1) ?? '', 257)).toBe(true)
    expect(requests).toHaveLength(258)
  })

  it('rejects invalid ancestor limits before making any request', async () => {
    const { client, requests } = mockClient([])
    await expect(client.isCommitReachable(pendingSha, 0)).rejects.toThrow('maxCommits')
    await expect(client.isCommitReachable(pendingSha, Number.POSITIVE_INFINITY)).rejects.toThrow('maxCommits')
    expect(requests).toHaveLength(0)
  })
})
