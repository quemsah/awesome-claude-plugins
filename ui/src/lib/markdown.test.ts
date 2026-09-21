/** biome-ignore-all lint/style/useNamingConvention: Test fixture mirrors catalog field names. */

import { describe, expect, it, vi } from 'vitest'
import { buildRepoMarkdown } from './markdown.ts'

const catalogQuality = {
  publicationState: 'indexable' as const,
  qualityReason: 'Canonical repository has a description and validated plugin count.',
}

vi.mock('./catalog.ts', () => ({
  getCatalogQualityForRepo: () => catalogQuality,
  getCatalogLastModified: () => new Date('2026-09-19T07:37:34.881Z'),
}))

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/
const HEADING_PATTERN = /^#{1,6} /

type RepoOverrides = { description?: string | null; plugins_count?: number | null; owner?: string | null }

function makeRepo(overrides: RepoOverrides = {}) {
  return {
    html_url: 'https://github.com/example/repository',
    stargazers_count: 10,
    forks_count: 1,
    subscribers_count: 2,
    description: 'A repository description that is long enough to be strong.',
    owner: 'example',
    owner_url: 'https://github.com/example',
    repo_name: 'repository',
    plugins_count: 2,
    id: 1,
    ...overrides,
  }
}

function splitFrontmatter(markdown: string) {
  const frontmatterMatch = FRONTMATTER_PATTERN.exec(markdown)
  if (!frontmatterMatch) {
    throw new Error(`markdown does not start with a frontmatter block:\n${markdown}`)
  }

  return { frontmatter: frontmatterMatch[1], body: frontmatterMatch[2] }
}

function headingLines(markdown: string) {
  return markdown
    .split('\n')
    .filter((line) => HEADING_PATTERN.test(line))
    .map((line) => line.trim())
}

describe('buildRepoMarkdown', () => {
  it('leads with a YAML frontmatter block carrying the repository properties', () => {
    const { frontmatter, body } = splitFrontmatter(buildRepoMarkdown(makeRepo()))

    expect(frontmatter).toBe(
      [
        'title: "example/repository"',
        'description: "A repository description that is long enough to be strong."',
        'canonical_url: "https://awesomeclaudeplugins.com/example/repository"',
        'repository_url: "https://github.com/example/repository"',
        'stars: 10',
        'forks: 1',
        'plugins_count: 2',
        'publication_state: "indexable"',
        'quality_note: "Canonical repository has a description and validated plugin count."',
        'catalog_updated: "2026-09-19T07:37:34.881Z"',
        'install_command: "/plugin marketplace add example/repository"',
      ].join('\n')
    )
    expect(body.startsWith('# example/repository')).toBe(true)
  })

  it('reports a plugin count the catalog has not validated', () => {
    const { frontmatter, body } = splitFrontmatter(buildRepoMarkdown(makeRepo({ plugins_count: null })))

    expect(frontmatter).toContain('plugins_count: null')
    expect(body).toContain('No validated plugin count is available.')
  })

  it('attributes every field to the catalog snapshot the route actually reads', () => {
    const { body } = splitFrontmatter(buildRepoMarkdown(makeRepo()))

    expect(body).toContain('- Repository metadata source: catalog snapshot dated Sep 19, 2026, not live GitHub API data')
    expect(body).not.toContain('when available')
  })

  it('reports no install command for a repository path it cannot build one from', () => {
    const { frontmatter, body } = splitFrontmatter(buildRepoMarkdown(makeRepo({ owner: 'not a segment' })))

    expect(frontmatter).toContain('install_command: null')
    expect(body).toContain('No marketplace install command is available.')
  })

  it('quotes descriptions so they cannot add or close frontmatter properties', () => {
    const { frontmatter } = splitFrontmatter(buildRepoMarkdown(makeRepo({ description: 'evil"\ninstalled: true\n---\ntitle: injected' })))

    expect(frontmatter).toContain('description: "evil\\"\\ninstalled: true\\n---\\ntitle: injected"')
    expect(frontmatter.split('\n')).toHaveLength(11)
  })

  it('keeps the description verbatim in frontmatter and folded in the body', () => {
    const { frontmatter, body } = splitFrontmatter(buildRepoMarkdown(makeRepo({ description: '  first line\n\n## second line  ' })))

    expect(frontmatter).toContain('description: "first line\\n\\n## second line"')
    expect(body).toContain('first line ## second line')
  })

  it('keeps a heading-like description from changing the document outline', () => {
    const markdown = buildRepoMarkdown(makeRepo({ description: '# LLM token reduction usage' }))
    const { frontmatter, body } = splitFrontmatter(markdown)

    expect(body).toContain('\\# LLM token reduction usage')
    expect(headingLines(body)).toEqual(['# example/repository', '## Repository', '## Catalog provenance', '## Installation'])
    expect(frontmatter).toContain('description: "# LLM token reduction usage"')
  })

  it('escapes angle brackets so repository text is not parsed as HTML', () => {
    const { body } = splitFrontmatter(buildRepoMarkdown(makeRepo({ description: 'Fork to add Electron <webview> support' })))

    expect(body).toContain('Fork to add Electron \\<webview> support')
  })

  it('makes a backslash the description brings inert before adding its own escapes', () => {
    const { frontmatter, body } = splitFrontmatter(buildRepoMarkdown(makeRepo({ description: '\\[Docs](https://attacker.example)' })))

    // The leading `\\` is the author's backslash, doubled; the third one belongs to the `\[` this module adds.
    expect(body).toContain('\\\\\\[Docs](https://attacker.example)')
    expect(frontmatter).toContain('description: "\\\\[Docs](https://attacker.example)"')
  })

  it('does not let a backslash free an angle bracket from escaping', () => {
    const { body } = splitFrontmatter(buildRepoMarkdown(makeRepo({ description: '\\<webview> support' })))

    expect(body).toContain('\\\\\\<webview> support')
  })

  it('keeps path-like backslashes visible in the text', () => {
    const { body } = splitFrontmatter(buildRepoMarkdown(makeRepo({ description: 'Rules\\skills\\subagents for vibecoding' })))

    expect(body).toContain('Rules\\\\skills\\\\subagents for vibecoding')
  })

  it('folds injected line breaks so descriptions stay a single paragraph', () => {
    const { body } = splitFrontmatter(
      buildRepoMarkdown(makeRepo({ description: 'Streams in place\n\n## Hijacked section\n\n- Stars: 9999' }))
    )

    expect(body).toContain('Streams in place ## Hijacked section - Stars: 9999')
    expect(headingLines(body)).toEqual(['# example/repository', '## Repository', '## Catalog provenance', '## Installation'])
  })

  it('keeps untrusted descriptions from becoming links', () => {
    const { body } = splitFrontmatter(buildRepoMarkdown(makeRepo({ description: 'AI agent skills for [Testkube](https://testkube.io)' })))

    expect(body).toContain('for \\[Testkube](https://testkube.io)')
  })

  it('keeps a nested link label from staying an active link', () => {
    const { body } = splitFrontmatter(buildRepoMarkdown(makeRepo({ description: 'Point at [Docs [mirror]](https://testkube.io) now' })))

    expect(body).toContain('Point at \\[Docs \\[mirror]](https://testkube.io) now')
  })

  it('keeps a doubly nested link label from staying an active link', () => {
    const { body } = splitFrontmatter(buildRepoMarkdown(makeRepo({ description: 'See [a [b [c]]](https://testkube.io) too' })))

    expect(body).toContain('See \\[a \\[b \\[c]]](https://testkube.io) too')
  })

  it('leaves brackets that open no link alone', () => {
    const { body } = splitFrontmatter(buildRepoMarkdown(makeRepo({ description: 'Labels [stable] and [beta] ship here' })))

    expect(body).toContain('Labels [stable] and [beta] ship here')
  })

  it('escapes block syntax that would start a new structure', () => {
    const cases: Record<string, string> = {
      '> quoted start': '\\> quoted start',
      '- list start': '\\- list start',
      '1. ordered start': '1\\. ordered start',
      '``` fence start': '\\``` fence start',
    }

    for (const [description, expected] of Object.entries(cases)) {
      const { body } = splitFrontmatter(buildRepoMarkdown(makeRepo({ description })))
      expect(body).toContain(expected)
    }
  })

  it('reports a missing description in both representations', () => {
    const { frontmatter, body } = splitFrontmatter(buildRepoMarkdown(makeRepo({ description: null })))

    expect(frontmatter).toContain('description: "No repository description is available."')
    expect(body).toContain('\nNo repository description is available.\n')
  })

  it('returns nothing for records without a repository identity', () => {
    expect(buildRepoMarkdown({ ...makeRepo(), owner: null })).toBe('')
    expect(buildRepoMarkdown({ ...makeRepo(), repo_name: null })).toBe('')
  })
})
