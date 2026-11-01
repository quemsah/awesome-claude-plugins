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
  name: 'example-plugin',
  displayName: 'Example Plugin',
  description: 'A plugin rendered from mocked marketplace data',
  version: '1.2.3',
  category: 'Testing',
  source: './plugins/example-plugin',
  author: { name: 'Example Maintainer', email: 'maintainer@example.dev' },
  keywords: ['testing', 'automation'],
  commands: './commands/example.md',
  agents: ['./agents/reviewer.md'],
  mcpServers: { testing: { command: 'node', args: ['./mcp/server.mjs'] } },
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './hooks/check.sh' }] }] },
}

const fallbackPlugin = {
  name: 'fallback-install-target',
  displayName: 'Fallback Install Target',
  description: 'A plugin sourced from another GitHub repository',
  source: {
    source: 'github',
    repo: 'elsewhere/shared-plugins',
    ref: 'main',
    sha: '0123456789abcdef0123456789abcdef01234567',
  },
  author: { email: 'fallback@example.dev' },
  commands: './commands/external.md',
  agents: ['./agents/external.md'],
  mcpServers: ['./mcp.json', { reviewer: { command: 'node', args: ['./servers/reviewer.mjs'] } }, 'https://example.com/reviewer.mcpb'],
}

const githubSourcePlugin = {
  name: 'github-source-plugin',
  displayName: 'GitHub Source Plugin',
  description: 'A plugin sourced from a GitHub repository',
  source: { source: 'git-subdir', url: 'https://github.com/elsewhere/shared-plugins.git', ref: 'main', path: 'plugins/review' },
  commands: './commands/review.md',
}

const unnamedPlugin = {
  description: 'A plugin without a name or identifier',
}

/**
 * Every fixture repository must exist in the catalog, because the repository page rejects
 * anything that is not catalogued before it ever reaches GitHub.
 */
const fixtures = {
  'acme/capsule': {
    repository: { status: 200, body: buildRepository('acme', 'capsule', { description: null, default_branch: 'trunk' }) },
    marketplace: { status: 404, body: { message: 'Not Found' } },
    plugin: {
      status: 200,
      body: {
        name: 'Nebula Review Tools',
        description: 'Nebula review automation provides precise, independent change summaries for plugin authors and maintainers.',
        commands: './commands/review.md',
      },
    },
  },
  'acme/market-hub': {
    marketplace: {
      status: 200,
      body: { name: 'market-hub', owner: { name: 'acme' }, plugins: [{ name: 'market-helper', source: './' }] },
    },
  },
  'ykdojo/claude-code-tips': {
    marketplace: {
      status: 200,
      body: { name: 'ykdojo', owner: { name: 'ykdojo' }, plugins: [examplePlugin, fallbackPlugin, githubSourcePlugin, unnamedPlugin] },
    },
  },
  'mksglu/context-mode': {
    marketplace: {
      status: 200,
      body: { name: 'context-mode', owner: { name: 'mksglu' }, plugins: [examplePlugin] },
    },
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
const PLUGIN_PATH_PATTERN = /^\/([^/]+)\/([^/]+)\/[^/]+\/\.claude-plugin\/plugin\.json$/

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  response.end(JSON.stringify(payload))
}

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
  const { pathname } = requestUrl
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    })
    response.end()
    return
  }

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

  const pluginMatch = PLUGIN_PATH_PATTERN.exec(pathname)
  if (pluginMatch) {
    if (requestUrl.searchParams.get('interrupt-body') === '1') {
      response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
      response.flushHeaders()
      response.write('{"name":')
      setTimeout(() => response.destroy(), 50)
      return
    }
    const [, owner, name] = pluginMatch
    const plugin = fixtures[`${owner}/${name}`]?.plugin
    sendJson(response, plugin?.status ?? 404, plugin?.body ?? { message: 'Not Found' })
    return
  }

  sendJson(response, 404, { message: 'Not Found' })
})

const port = Number(process.env.MOCK_GITHUB_PORT ?? 3100)

server.on('error', (error) => {
  console.error(`mock-github-server: cannot listen on 127.0.0.1:${port} (${error.code}).`)
  console.error('Free the port, or set MOCK_GITHUB_PORT so ui/playwright.config.ts follows it.')
  process.exit(1)
})

server.listen(port, '127.0.0.1')
