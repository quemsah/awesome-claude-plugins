import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { PluginSource } from './PluginSource.tsx'

it('links root plugin sources to the repository instead of a blob path', () => {
  for (const source of ['.', './']) {
    const html = renderToStaticMarkup(PluginSource({ defaultBranch: 'main', repoPath: 'mksglu/context-mode', source }))
    expect(html).toContain('href="https://github.com/mksglu/context-mode"')
    expect(html).toContain('aria-label="Open source repository mksglu/context-mode in a new tab"')
    expect(html).not.toContain('/blob/')
  }
})

it('retains file source links for non-root paths', () => {
  const html = renderToStaticMarkup(PluginSource({ defaultBranch: 'main', repoPath: 'mksglu/context-mode', source: './plugins/review' }))
  expect(html).toContain('href="https://github.com/mksglu/context-mode/blob/main/./plugins/review"')
})
