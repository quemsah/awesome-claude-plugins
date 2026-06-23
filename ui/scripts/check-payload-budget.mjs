import { readFileSync } from 'node:fs'

const repos = readJson('../src/data/repos.json')
const pageSize = 24
const maxInitialPayloadBytes = 250_000
const maxInitialToCatalogRatio = 0.08
const catalogBytes = byteLength(readFileSync(new URL('../src/data/repos.json', import.meta.url), 'utf8'))
const initialResult = buildInitialResult()
const initialPayloadBytes = byteLength(JSON.stringify(initialResult))
const ratio = initialPayloadBytes / catalogBytes

const report = {
  catalogBytes,
  pageSize,
  initialPayloadBytes,
  maxInitialPayloadBytes,
  initialToCatalogRatio: Number(ratio.toFixed(4)),
  maxInitialToCatalogRatio,
}

console.log(JSON.stringify(report, null, 2))

if (initialPayloadBytes > maxInitialPayloadBytes || ratio > maxInitialToCatalogRatio) {
  console.error('Initial route payload budget exceeded.')
  process.exitCode = 1
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'))
}

function buildInitialResult() {
  const sortedRepos = repos.filter((repo) => repo.repo_name !== null).sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0))
  const visibleRepos = sortedRepos.slice(0, pageSize)

  return {
    repos: visibleRepos,
    query: '',
    sortOption: 'stars-desc',
    page: 1,
    pageSize,
    totalRepoCount: sortedRepos.length,
    totalPluginCount: sortedRepos.reduce((total, repo) => total + (repo.plugins_count || 0), 0),
    hasMore: sortedRepos.length > pageSize,
  }
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8')
}
