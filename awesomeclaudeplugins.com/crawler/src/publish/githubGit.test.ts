import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { GitHubGitClient, GitHubGitConflictError, GitHubGitHttpError, GitHubGitResponseError, GitHubGitTimeoutError } from './githubGit.js'

const baseSha = 'a'.repeat(40)
const baseTree = 'b'.repeat(40)
const treeSha = 'c'.repeat(40)
const pendingSha = 'd'.repeat(40)
const laterSha = 'e'.repeat(40)
const rootSha = 'f'.repeat(40)
const files = {
  readme: '# Catalog\n',
  reposJson: '[{"id":1}]\n',
  statsJson: '[{"id":1}]\n',
  markdownPathsJson: '["owner/repo.md"]\n',
}

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

function comparison(status: 'ahead' | 'behind' | 'diverged' | 'identical'): Response {
  return Response.json({ status })
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
  it('publishes complete split catalog artifacts atomically with the original snapshot', async () => {
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
    const published = payload(requests[2]) as { base_tree: string; tree: Array<{ path: string; content: string }> }
    expect(published.tree).toHaveLength(105)
    const searchIndex = published.tree.find((entry) => entry.path.endsWith('/search-index.json'))
    const decodedIndex = JSON.parse(searchIndex?.content ?? '{}') as { format: string; rows: unknown[][] }
    expect(decodedIndex.format).toBe('v1')
    expect(decodedIndex.rows).toHaveLength(1)
    expect(decodedIndex.rows[0].slice(0, 6)).toEqual([1, null, null, 0, 0, null])
    expect(published.tree.find((entry) => entry.path.endsWith('/repo-details/1.json'))).toBeDefined()
    expect(published.tree.find((entry) => entry.path.endsWith('/repo-details/99.json'))).toBeDefined()
    expect({
      base_tree: published.base_tree,
      tree: published.tree.filter((entry) => !entry.path.endsWith('/search-index.json') && !entry.path.includes('/repo-details/')),
    }).toEqual({
      base_tree: baseTree,
      tree: [
        { path: 'README.md', mode: '100644', type: 'blob', content: '# Catalog\n' },
        { path: 'awesomeclaudeplugins.com/ui/src/data/repos.json', mode: '100644', type: 'blob', content: '[{"id":1}]\n' },
        { path: 'awesomeclaudeplugins.com/ui/src/data/stats.json', mode: '100644', type: 'blob', content: '[{"id":1}]\n' },
        { path: 'awesomeclaudeplugins.com/ui/src/data/markdown-paths.json', mode: '100644', type: 'blob', content: '["owner/repo.md"]\n' },
      ],
    })
    expect(payload(requests[3])).toEqual({ tree: treeSha, parents: [baseSha], message: 'Update catalog' })
    expect(payload(requests[4])).toEqual({ sha: pendingSha, force: false })
  })

  it('rebuilds derived artifacts for every new catalog revision', async () => {
    const { client, requests } = mockClient([Response.json({ sha: treeSha }), Response.json({ sha: treeSha })])
    await client.createTree(baseTree, { ...files, reposJson: '[{"id":1,"owner":"one","repo_name":"first","description":"Old"}]' })
    await client.createTree(baseTree, { ...files, reposJson: '[{"id":2,"owner":"two","repo_name":"second","description":"New"}]' })
    const entries = requests.map((request) => (payload(request) as { tree: Array<{ path: string; content: string }> }).tree)
    const indexRows = entries.map((tree) => {
      const index = tree.find((entry) => entry.path.endsWith('/search-index.json'))
      return (JSON.parse(index?.content ?? '{}') as { rows: unknown[][] }).rows
    })
    expect(indexRows[0][0][0]).toBe(1)
    expect(indexRows[1][0][0]).toBe(2)
    const buckets = entries.map((tree, i) => {
      const path = `/repo-details/${i + 1}.json`
      return JSON.parse(tree.find((entry) => entry.path.endsWith(path))?.content ?? '{}') as Record<string, unknown>
    })
    expect(buckets[0]).toHaveProperty('1')
    expect(buckets[1]).toHaveProperty('2')
  })

  it('batches large snapshots into intermediate Git trees before committing', async () => {
    const large = {
      ...files,
      reposJson: JSON.stringify([{ id: 1, owner: 'one', repo_name: 'demo', description: 'a'.repeat(5 * 1024 * 1024) }]),
    }
    const { client, requests } = mockClient(Array.from({ length: 12 }, () => Response.json({ sha: treeSha })))
    expect(await client.createTree(baseTree, large)).toBe(treeSha)
    const trees = requests.map((request) => payload(request) as { base_tree: string; tree: Array<{ path: string; content: string }> })
    expect(trees.length).toBeGreaterThan(2)
    expect(trees[0].base_tree).toBe(baseTree)
    for (const tree of trees.slice(1)) expect(tree.base_tree).toBe(treeSha)
    expect(trees.flatMap((tree) => tree.tree)).toHaveLength(105)
    for (const tree of trees) {
      if (Buffer.byteLength(JSON.stringify(tree)) > 4 * 1024 * 1024) {
        expect(tree.tree).toHaveLength(1) // The original large blob cannot be split.
      }
    }
    expect(requests.every((request) => request.url.endsWith('/trees'))).toBe(true)
  })

  it('does not advance the ref when a later tree chunk fails', async () => {
    const large = { ...files, reposJson: JSON.stringify([{ id: 1, description: 'a'.repeat(5 * 1024 * 1024) }]) }
    const { client, requests } = mockClient([Response.json({ sha: treeSha }), new Response('', { status: 422 })])
    await expect(client.createTree(baseTree, large)).rejects.toMatchObject({ status: 422 })
    expect(requests).toHaveLength(2)
    expect(requests.every((request) => request.url.endsWith('/trees'))).toBe(true)
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

  it('rejects missing blob content before POST so every tree contains four string blobs', async () => {
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

  it('preserves shutdown while parsing a PATCH conflict response body', async () => {
    const shutdown = new AbortController()
    const body = new ReadableStream({
      pull(controller) {
        shutdown.abort()
        controller.error(new DOMException('shutdown body read', 'AbortError'))
      },
    })
    const { client } = mockClient([new Response(body, { status: 422 })], { signal: shutdown.signal })

    await expect(client.updateBranch(pendingSha)).rejects.toMatchObject({ category: 'terminated' })
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

  it.each(['ahead', 'identical'] as const)('treats compare status %s as reachable with one REST request', async (status) => {
    const { client, requests } = mockClient([comparison(status)])
    expect(await client.isCommitReachable(pendingSha)).toBe(true)
    expect(requests.map(({ url, init }) => [init?.method ?? 'GET', url])).toEqual([
      ['GET', `https://api.github.com/repos/acme/catalog/compare/${pendingSha}...main`],
    ])
  })

  it.each(['behind', 'diverged'] as const)('treats compare status %s as not reachable', async (status) => {
    const { client, requests } = mockClient([comparison(status)])
    expect(await client.isCommitReachable(pendingSha)).toBe(false)
    expect(requests).toHaveLength(1)
  })

  it('encodes a slash-containing branch as one compare head ref', async () => {
    const { client, requests } = mockClient([comparison('ahead')], { branch: 'release/v1+beta' })
    expect(await client.isCommitReachable(pendingSha)).toBe(true)
    expect(requests[0].url).toBe(`https://api.github.com/repos/acme/catalog/compare/${pendingSha}...release%2Fv1%2Bbeta`)
  })

  it('rejects an unknown compare status rather than guessing publication state', async () => {
    const { client } = mockClient([Response.json({ status: 'private-publish-token mystery' })])
    const failure = await client.isCommitReachable(pendingSha).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(GitHubGitResponseError)
    expect(String(failure)).not.toContain('private-publish-token')
  })

  it('rejects an invalid pending SHA before making a compare request', async () => {
    const { client, requests } = mockClient([])
    await expect(client.isCommitReachable('not-a-sha')).rejects.toThrow('SHA')
    expect(requests).toHaveLength(0)
  })

  it('uploads a release asset and returns its SHA-256 and download URL', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'git-upload-test-'))
    const filePath = join(tmp, 'catalog.sqlite')
    const content = Buffer.from('sqlite sample catalog database content')
    const expectedSha = createHash('sha256').update(content).digest('hex')
    writeFileSync(filePath, content)

    try {
      const downloadUrl = 'https://github.com/acme/catalog/releases/download/catalog-snap1/catalog.sqlite'
      const { client, requests } = mockClient([
        Response.json({ id: 10, upload_url: 'https://uploads.github.com/repos/acme/catalog/releases/10/assets{?name,label}' }),
        Response.json([]),
        Response.json({ id: 101, browser_download_url: downloadUrl }, { status: 201 }),
        new Response(content),
      ])

      const result = await client.uploadReleaseAsset('catalog-snap1', 'catalog.sqlite', filePath)
      expect(result).toEqual({ downloadUrl, sha256: expectedSha, releaseId: 10, assetId: 101, size: content.length })
      expect(requests.map((r) => [r.init?.method ?? 'GET', r.url])).toEqual([
        ['GET', 'https://api.github.com/repos/acme/catalog/releases/tags/catalog-snap1'],
        ['GET', 'https://api.github.com/repos/acme/catalog/releases/10/assets'],
        ['POST', 'https://uploads.github.com/repos/acme/catalog/releases/10/assets?name=catalog.sqlite'],
        ['GET', downloadUrl],
      ])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('reuses existing release asset without deleting it if already present', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'git-upload-reuse-'))
    const filePath = join(tmp, 'catalog.sqlite')
    const content = Buffer.from('sqlite sample catalog database content')
    const expectedSha = createHash('sha256').update(content).digest('hex')
    writeFileSync(filePath, content)

    try {
      const downloadUrl = 'https://github.com/acme/catalog/releases/download/catalog-snap2/catalog.sqlite'
      const { client, requests } = mockClient([
        Response.json({ id: 20, upload_url: 'https://uploads.github.com/repos/acme/catalog/releases/20/assets{?name,label}' }),
        Response.json([{ id: 102, name: 'catalog.sqlite', browser_download_url: downloadUrl }]),
        new Response(content),
      ])

      const result = await client.uploadReleaseAsset('catalog-snap2', 'catalog.sqlite', filePath)
      expect(result).toEqual({ downloadUrl, sha256: expectedSha, releaseId: 20, assetId: 102, size: content.length })
      expect(requests.map((r) => [r.init?.method ?? 'GET', r.url])).toEqual([
        ['GET', 'https://api.github.com/repos/acme/catalog/releases/tags/catalog-snap2'],
        ['GET', 'https://api.github.com/repos/acme/catalog/releases/20/assets'],
        ['GET', downloadUrl],
      ])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('rejects existing release asset if remote SHA-256 does not match local file', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'git-upload-mismatch-'))
    const filePath = join(tmp, 'catalog.sqlite')
    const content = Buffer.from('sqlite sample catalog database content')
    writeFileSync(filePath, content)

    try {
      const downloadUrl = 'https://github.com/acme/catalog/releases/download/catalog-snap3/catalog.sqlite'
      const differentContent = Buffer.from('different remote sqlite bytes')
      const { client } = mockClient([
        Response.json({ id: 30, upload_url: 'https://uploads.github.com/repos/acme/catalog/releases/30/assets{?name,label}' }),
        Response.json([{ id: 103, name: 'catalog.sqlite', browser_download_url: downloadUrl }]),
        new Response(differentContent),
      ])

      await expect(client.uploadReleaseAsset('catalog-snap3', 'catalog.sqlite', filePath)).rejects.toThrow(
        /Existing release asset SHA-256 does not match/,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('propagates 503 error when listing release assets without attempting duplicate upload', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'git-upload-err-'))
    const filePath = join(tmp, 'catalog.sqlite')
    const content = Buffer.from('sqlite sample catalog database content')
    writeFileSync(filePath, content)

    try {
      const { client, requests } = mockClient([
        Response.json({ id: 40, upload_url: 'https://uploads.github.com/repos/acme/catalog/releases/40/assets{?name,label}' }),
        new Response('Service Unavailable', { status: 503 }),
      ])

      await expect(client.uploadReleaseAsset('catalog-snap4', 'catalog.sqlite', filePath)).rejects.toThrow(GitHubGitHttpError)
      // Must NOT attempt POST to uploads.github.com
      expect(requests.some((r) => r.init?.method === 'POST')).toBe(false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('retries verifying existing asset when POST returns 422 duplicate conflict', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'git-upload-422-'))
    const filePath = join(tmp, 'catalog.sqlite')
    const content = Buffer.from('sqlite sample catalog database content')
    const expectedSha = createHash('sha256').update(content).digest('hex')
    writeFileSync(filePath, content)

    try {
      const downloadUrl = 'https://github.com/acme/catalog/releases/download/catalog-snap5/catalog.sqlite'
      const { client, requests } = mockClient([
        // 1. getOrCreateRelease
        Response.json({ id: 50, upload_url: 'https://uploads.github.com/repos/acme/catalog/releases/50/assets{?name,label}' }),
        // 2. findReleaseAsset: returns empty list
        Response.json([]),
        // 3. postReleaseAsset: returns 422 Unprocessable Entity (already exists)
        new Response('Validation Failed: already_exists', { status: 422 }),
        // 4. retry findReleaseAsset: finds the asset
        Response.json([{ id: 105, name: 'catalog.sqlite', browser_download_url: downloadUrl }]),
        // 5. verifyExistingAsset: downloads and verifies sha
        new Response(content),
      ])

      const result = await client.uploadReleaseAsset('catalog-snap5', 'catalog.sqlite', filePath)
      expect(result).toEqual({ downloadUrl, sha256: expectedSha, releaseId: 50, assetId: 105, size: content.length })
      expect(requests.some((r) => r.init?.method === 'POST')).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
