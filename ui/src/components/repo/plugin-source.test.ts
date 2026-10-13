import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PluginSource } from './PluginSource.tsx'

describe('PluginSource', () => {
  it('links a GitHub source object to its repository root', () => {
    const markup = renderToStaticMarkup(
      createElement(PluginSource, { source: { source: 'github', repo: 'team/tool' }, repoPath: 'marketplace/catalog' })
    )

    expect(markup).toContain('href="https://github.com/team/tool"')
  })
})
