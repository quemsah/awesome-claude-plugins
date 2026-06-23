/** biome-ignore-all lint/style/useNamingConvention: catalog fixtures use checked-in snake_case fields */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildLlmsText, getCatalogSummary } from '../src/lib/llmsText.mjs'

const UNSUPPORTED_CLAIMS = /API access|contribution form|tutorials|integration guides|curated editorial collections/
const CAPABILITIES_START = '## Implemented Capabilities'
const CAPABILITIES_END = '## Not Provided'

describe('llms text', () => {
  it('renders the machine-readable summary from catalog metadata', () => {
    const text = buildLlmsText({
      repoCount: 2,
      pluginRepositoryCount: 1,
      pluginCount: 3,
      updatedAt: '2026-06-22T06:06:29.505Z',
    })

    assert.equal(
      text,
      `# Awesome Claude Plugins

> A generated catalog of GitHub repositories related to Claude Code plugins, MCP servers, and agent skills.

This site helps users browse repository records, compare basic GitHub popularity signals, copy Claude plugin marketplace install commands, and inspect historical catalog growth.

## Current Catalog Snapshot

- Repositories indexed: 2
- Repositories with plugin counts: 1
- Plugin entries reported by catalog data: 3
- Last catalog update: 2026-06-22

## Real Routes

- \`/\`: repository catalog with search, sorting, and load-more browsing.
- \`/stats\`: historical repository count charts based on checked-in snapshot data.
- \`/about\`: project purpose and automated discovery summary.
- \`/{owner}/{repo}\`: repository detail page for a catalog entry.
- \`/sitemap.xml\`: sitemap for crawlers.
- \`/manifest.webmanifest\`: web app manifest.
- \`/llms.txt\`: this machine-readable project summary.

## Implemented Capabilities

- Browse GitHub repository records from the generated catalog.
- Search the visible catalog by repository text.
- Sort repositories by stars, forks, and plugin count.
- Copy \`/plugin marketplace add owner/repo\` install commands from repository cards.
- View basic repository details and plugin entries when GitHub and raw repository data are available.
- View historical catalog-size statistics from checked-in snapshot data.

## Not Provided

- No public API is exposed by this app.
- No contribution form is implemented in the UI.
- No tutorials, integration guides, or curated editorial collections are implemented.
- No private quality endorsement is implied by catalog inclusion.

## Source

- GitHub repository: https://github.com/quemsah/awesome-claude-plugins`
    )
  })

  it('summarizes counts from repository and stats data', () => {
    assert.deepEqual(
      getCatalogSummary(
        [{ plugins_count: 2 }, { plugins_count: null }, { plugins_count: 0 }, { plugins_count: 1 }],
        [{ date: '2026-06-21T00:00:00.000Z' }]
      ),
      {
        repoCount: 4,
        pluginRepositoryCount: 2,
        pluginCount: 3,
        updatedAt: '2026-06-21T00:00:00.000Z',
      }
    )
  })

  it('keeps unsupported claims out of capability text', () => {
    const text = buildLlmsText({
      repoCount: 1,
      pluginRepositoryCount: 0,
      pluginCount: 0,
      updatedAt: null,
    })
    const capabilityText = text.split(CAPABILITIES_START)[1].split(CAPABILITIES_END)[0]

    assert.doesNotMatch(capabilityText, UNSUPPORTED_CLAIMS)
  })
})
