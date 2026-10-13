import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { GitHubRepository } from '../../schemas/github.schema.ts'
import { PluginCard } from './PluginCard.tsx'

const componentFiles = {
  commands: ['./commands/run.md'],
  agents: ['./agents/reviewer.md'],
  mcpServers: ['./mcp/server.json'],
}
const componentFilePattern = /\/(commands|agents|mcp)\//
const defaultBranchField = 'default_branch'

function getComponentUrls(source: Parameters<typeof PluginCard>[0]['plugin']['source']) {
  const html = renderToStaticMarkup(
    createElement(PluginCard, {
      plugin: { name: 'demo', source, ...componentFiles },
      repoPath: 'catalog/market',
      repo: { [defaultBranchField]: 'main' } as GitHubRepository,
    })
  )

  return [...html.matchAll(/href="([^"]+)"/g)].map(([, href]) => href).filter((href) => componentFilePattern.test(href))
}

const localFiles = [
  'https://github.com/catalog/market/blob/main/plugins/demo/commands/run.md',
  'https://github.com/catalog/market/blob/main/plugins/demo/agents/reviewer.md',
  'https://github.com/catalog/market/blob/main/plugins/demo/mcp/server.json',
]

describe('PluginCard component links', () => {
  it('resolves files from a local plugin directory', () => {
    expect(getComponentUrls('./plugins/demo')).toEqual(localFiles)
  })

  it('resolves files from an external GitHub source repository', () => {
    expect(getComponentUrls({ source: 'github', repo: 'team/tool', branch: 'release/v1' })).toEqual([
      'https://github.com/team/tool/blob/release/v1/commands/run.md',
      'https://github.com/team/tool/blob/release/v1/agents/reviewer.md',
      'https://github.com/team/tool/blob/release/v1/mcp/server.json',
    ])
  })

  it('resolves files from a git-subdir source', () => {
    expect(getComponentUrls({ source: 'git-subdir', url: 'team/tool', path: 'plugins/demo', ref: 'v2' })).toEqual([
      'https://github.com/team/tool/blob/v2/plugins/demo/commands/run.md',
      'https://github.com/team/tool/blob/v2/plugins/demo/agents/reviewer.md',
      'https://github.com/team/tool/blob/v2/plugins/demo/mcp/server.json',
    ])
  })

  it('resolves files from an absolute GitHub URL source', () => {
    expect(getComponentUrls({ source: 'git-subdir', url: 'https://github.com/team/tool.git', path: 'plugins/demo', ref: 'main' })).toEqual([
      'https://github.com/team/tool/blob/main/plugins/demo/commands/run.md',
      'https://github.com/team/tool/blob/main/plugins/demo/agents/reviewer.md',
      'https://github.com/team/tool/blob/main/plugins/demo/mcp/server.json',
    ])
  })
})
