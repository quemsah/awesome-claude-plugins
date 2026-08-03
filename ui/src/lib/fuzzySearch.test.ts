/** biome-ignore-all lint/style/useNamingConvention: Test fixture mirrors catalog field names. */

import { describe, expect, it } from 'vitest'
import { createFuseIndex } from './fuzzySearch.ts'

describe('createFuseIndex', () => {
  it('matches optional marketplace capability fields when catalog data provides them', () => {
    const repo = {
      html_url: 'https://github.com/example/repository',
      stargazers_count: 10,
      forks_count: 1,
      subscribers_count: 1,
      description: 'A repository description.',
      owner: 'example',
      owner_url: 'https://github.com/example',
      repo_name: 'repository',
      plugins_count: 1,
      plugin_names: ['Code Reviewer'],
      plugin_descriptions: ['Reviews pull requests'],
      plugin_categories: ['Development'],
      plugin_keywords: ['review'],
      plugin_commands: ['commands/review.md'],
      plugin_agents: ['agents/reviewer.md'],
      plugin_mcp_servers: ['mcp/review.json'],
      id: 1,
    }

    expect(createFuseIndex([repo]).search('reviewer')).toHaveLength(1)
    expect(createFuseIndex([repo]).search('pull requests')).toHaveLength(1)
  })
})
