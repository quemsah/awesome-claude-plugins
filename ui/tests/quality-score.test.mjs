/** biome-ignore-all lint/style/useNamingConvention: catalog fixtures use snake_case fields */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { compareRepoQuality, getRepoQualityScore } from '../src/lib/qualityScore.mjs'

const weakBroadRepo = {
  repo_name: 'general-platform',
  description: 'A broad backend platform for application teams',
  stargazers_count: 1000,
  forks_count: 100,
  plugins_count: 1,
  owner: 'example',
}

const focusedPluginRepo = {
  repo_name: 'claude-skills',
  description: 'Claude Code plugin skills for focused agent workflows',
  stargazers_count: 950,
  forks_count: 95,
  plugins_count: 2,
  owner: 'example',
}

describe('quality scoring', () => {
  it('is deterministic for the same repository inputs', () => {
    assert.equal(getRepoQualityScore(focusedPluginRepo), getRepoQualityScore(focusedPluginRepo))
  })

  it('ranks focused plugin repositories above similar broad matches', () => {
    assert.equal(compareRepoQuality(focusedPluginRepo, weakBroadRepo) < 0, true)
  })

  it('rewards plugin count when other signals are similar', () => {
    assert.equal(
      getRepoQualityScore({ ...focusedPluginRepo, plugins_count: 5 }) > getRepoQualityScore({ ...focusedPluginRepo, plugins_count: 1 }),
      true
    )
  })
})
