import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PluginSource } from './PluginSource.tsx'

describe('PluginSource', () => {
  it.each([
    [{ sha: 'a'.repeat(40), ref: 'release/v2' }, 'a'.repeat(40)],
    [{ sha: 'a'.repeat(40), ref: 'release/v2', branch: 'legacy-branch', commit: 'b'.repeat(40) }, 'a'.repeat(40)],
    [{ branch: 'legacy-branch', ref: 'release/v2', commit: 'b'.repeat(40) }, 'legacy-branch'],
    [{ ref: 'release/v2', commit: 'b'.repeat(40) }, 'release/v2'],
    [{ commit: 'b'.repeat(40) }, 'b'.repeat(40)],
    [{}, 'HEAD'],
  ])('uses %s as the GitHub source ref', (fields, expectedRef) => {
    const markup = renderToStaticMarkup(
      createElement(PluginSource, {
        repoPath: 'marketplace/catalog',
        source: { source: 'github', repo: 'owner/plugin', path: 'plugins/example', ...fields },
      })
    )

    expect(markup).toContain(`href="https://github.com/owner/plugin/blob/${expectedRef}/plugins/example"`)
  })
})
