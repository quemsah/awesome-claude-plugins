/** Bounded, read-only audit. Never opens SQLite or publishes catalog data. */
import { GitHubClient } from '../src/github/client.js'
import { parseRepositoryUrl } from '../src/github/repositoryUrl.js'
import { discoverySearchFamilies } from '../src/github/searchFamilies.js'
import type { SizeRange } from '../src/github/sizeRanges.js'

const token = process.env.GITHUB_READ_TOKEN
if (!token) throw new Error('GITHUB_READ_TOKEN is required for this read-only audit')
const controller = new AbortController()
let searchRequests = 0
let coreRequests = 0
let budgetExceeded = false
let waitMs = 0
let retryWaitMs = 0
const client = new GitHubClient({
  token,
  signal: controller.signal,
  log: (event) => {
    waitMs += event.waitMs ?? 0
    retryWaitMs += event.retryWaitMs ?? 0
  },
  fetch: async (input, init) => {
    if (new URL(String(input)).pathname === '/search/code') {
      if (searchRequests >= 20) {
        budgetExceeded = true
        controller.abort()
        throw new Error('Audit search budget exhausted')
      }
      searchRequests++
    } else coreRequests++
    return fetch(input, init)
  },
})
const family = discoverySearchFamilies.find(({ queryFamily }) => queryFamily === 'plugin_filename_path')
if (!family) throw new Error('Standalone search family is not configured')
const ranges: SizeRange[] = [[0, 400000]]
const candidates = new Set<string>()
const samples: Array<{ repository: string; outcome: string }> = []
let hits = 0
let nonRootHits = 0
let complete = true
const warnings: string[] = []
const queries: string[] = []
const started = Date.now()
try {
  while (ranges.length && searchRequests < 20 && candidates.size < 20) {
    const range = ranges.shift()
    if (!range) break
    const query = family.buildQuery(range)
    queries.push(query)
    for (let page = 1; page <= 10 && searchRequests < 20 && candidates.size < 20; page++) {
      const result = await client.searchCode(query, page)
      hits += result.items.length
      if (result.incomplete_results) {
        complete = false
        warnings.push('incomplete_results')
      }
      for (const item of result.items) {
        if (item.path !== '.claude-plugin/plugin.json') {
          nonRootHits++
          continue
        }
        const identity = parseRepositoryUrl(item.repository.html_url)
        if (!identity || item.repository.private) continue
        const key = `${identity.owner}/${identity.repo}`.toLowerCase()
        if (candidates.has(key)) continue
        if (candidates.size >= 20) {
          complete = false
          break
        }
        candidates.add(key)
        const marketplace = await client.getMarketplace(identity.owner, identity.repo)
        if (marketplace.kind !== 'not-found') {
          samples.push({ repository: key, outcome: marketplace.kind === 'found' ? 'marketplace' : marketplace.kind })
          continue
        }
        const plugin = await client.getPluginManifest(identity.owner, identity.repo)
        samples.push({ repository: key, outcome: plugin.kind === 'found' ? 'standalone-plugin' : plugin.kind })
      }
      if (result.total_count >= 1000) {
        complete = false
        warnings.push('saturated')
        if (range[0] < range[1]) {
          const mid = Math.floor((range[0] + range[1]) / 2)
          ranges.push([range[0], mid], [mid + 1, range[1]])
        }
        break
      }
      if (page * 100 >= result.total_count || result.items.length === 0) break
      if (page === 10) complete = false
    }
  }
} catch (error) {
  complete = false
  warnings.push(budgetExceeded ? 'request_budget' : error instanceof Error ? error.name : 'audit_error')
}
if (ranges.length || candidates.size >= 20 || searchRequests >= 20) complete = false
console.log(
  JSON.stringify(
    {
      scope: 'bounded_root_plugin_audit',
      complete,
      queries,
      searchRequests,
      coreRequests,
      durationMs: Date.now() - started,
      hits,
      nonRootHits,
      uniqueCandidates: candidates.size,
      acceptedStandalonePlugins: samples.filter(({ outcome }) => outcome === 'standalone-plugin').length,
      samples,
      warnings: [...new Set(warnings)],
      waitMs,
      retryWaitMs,
    },
    null,
    2,
  ),
)
