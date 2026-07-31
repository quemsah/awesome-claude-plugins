/** biome-ignore-all lint/style/useNamingConvention: Fixture mirrors GitHub API field names. */
import { createServer } from 'node:http'

function buildRepository(owner, name, overrides = {}) {
  return {
    name,
    full_name: `${owner}/${name}`,
    description: 'A mocked Claude Code plugin repository',
    html_url: `https://github.com/${owner}/${name}`,
    homepage: `https://example.dev/${name}`,
    stargazers_count: 7,
    forks_count: 2,
    watchers_count: 3,
    open_issues_count: 1,
    topics: ['claude-code', 'plugins'],
    language: 'TypeScript',
    license: { name: 'MIT' },
    size: 2048,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    pushed_at: '2026-06-02T00:00:00Z',
    default_branch: 'main',
    owner: {
      login: owner,
      avatar_url: 'https://github.com/images/error/octocat_happy.gif',
      html_url: `https://github.com/${owner}`,
      type: 'User',
    },
    ...overrides,
  }
}

const examplePlugin = {
  name: 'Example Plugin',
  id: 'example-plugin',
  description: 'A plugin rendered from mocked marketplace data',
  version: '1.2.3',
  category: 'Testing',
  source: '.claude-plugin/plugin.json',
  author: { name: 'Example Maintainer', email: 'maintainer@example.dev' },
  keywords: ['testing', 'automation'],
  commands: ['commands/example.md'],
  agents: ['agents/reviewer.md'],
  mcpServers: ['mcp/server.json'],
}

const fallbackPlugin = {
  name: 'Fallback Install Target',
  description: 'A plugin whose source points at another repository',
  source: { source: 'plugins/fallback.json', repo: 'elsewhere/shared-plugins', branch: 'main' },
  author: { email: 'fallback@example.dev' },
}

const unnamedPlugin = {
  description: 'A plugin without a name or identifier',
}

/**
 * Every fixture repository must exist in the catalog, because the repository page rejects
 * anything that is not catalogued before it ever reaches GitHub.
 */
const fixtures = {
  'ykdojo/claude-code-tips': {
    marketplace: { status: 200, body: { plugins: [examplePlugin, fallbackPlugin, unnamedPlugin] } },
  },
  'mksglu/context-mode': {
    marketplace: { status: 200, body: [examplePlugin] },
  },
  'ZeframLou/call-me': {
    marketplace: { status: 404, body: { message: 'Not Found' } },
  },
  'kaito-project/kaito': {
    marketplace: { status: 500, body: { message: 'Server Error' } },
  },
  'jfernandez/mdserve': {
    repository: { status: 404, body: { message: 'Not Found' } },
  },
  'todorkolev/lean-playground': {
    repository: { status: 500, body: { message: 'Server Error' } },
  },
}

const REPOSITORY_PATH_PATTERN = /^\/repos\/([^/]+)\/([^/]+)$/
const MARKETPLACE_PATH_PATTERN = /^\/([^/]+)\/([^/]+)\/[^/]+\/\.claude-plugin\/marketplace\.json$/

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  if (pathname === '/health') {
    response.writeHead(204)
    response.end()
    return
  }

  const repositoryMatch = REPOSITORY_PATH_PATTERN.exec(pathname)
  if (repositoryMatch) {
    const [, owner, name] = repositoryMatch
    const fixture = fixtures[`${owner}/${name}`]
    if (!fixture) {
      sendJson(response, 404, { message: 'Not Found' })
      return
    }
    if (fixture.repository) {
      sendJson(response, fixture.repository.status, fixture.repository.body)
      return
    }
    sendJson(response, 200, buildRepository(owner, name))
    return
  }

  const marketplaceMatch = MARKETPLACE_PATH_PATTERN.exec(pathname)
  if (marketplaceMatch) {
    const [, owner, name] = marketplaceMatch
    const marketplace = fixtures[`${owner}/${name}`]?.marketplace
    if (!marketplace) {
      sendJson(response, 404, { message: 'Not Found' })
      return
    }
    sendJson(response, marketplace.status, marketplace.body)
    return
  }

  sendJson(response, 404, { message: 'Not Found' })
})

server.listen(3100, '127.0.0.1')
