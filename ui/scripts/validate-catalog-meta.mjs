import { readFileSync } from 'node:fs'
import { CatalogMetaSchema } from '../src/schemas/catalog-meta.schema.ts'

const catalogMeta = readJson('../src/data/catalog-meta.json')
const repos = readJson('../src/data/repos.json')
const stats = readJson('../src/data/stats.json')
const failures = []

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'))
}

function fail(message) {
  failures.push(message)
}

const validationResult = CatalogMetaSchema.safeParse(catalogMeta)

if (!validationResult.success) {
  fail(`catalog-meta.json does not match schema: ${validationResult.error.message}`)
} else {
  const meta = validationResult.data
  const repositoryCount = Array.isArray(repos) ? repos.length : 0
  const pluginCount = Array.isArray(repos) ? repos.reduce((total, repo) => total + (repo.plugins_count || 0), 0) : 0
  const latestStats = Array.isArray(stats) ? stats.at(-1) : null

  if (meta.repository_count !== repositoryCount) {
    fail(`metadata repository_count=${meta.repository_count} does not match repos.json count=${repositoryCount}`)
  }

  if (meta.plugin_count !== pluginCount) {
    fail(`metadata plugin_count=${meta.plugin_count} does not match repos.json plugin total=${pluginCount}`)
  }

  if (!latestStats) {
    fail('stats.json must contain at least one snapshot')
  } else {
    if (latestStats.date !== meta.generated_at) {
      fail(`metadata generated_at=${meta.generated_at} does not match latest stats date=${latestStats.date}`)
    }

    if (latestStats.size !== meta.repository_count) {
      fail(`latest stats size=${latestStats.size} does not match metadata repository_count=${meta.repository_count}`)
    }
  }

  if (!meta.validation_summary.repository_count_matches_latest_stats) {
    fail('metadata validation summary must confirm repository_count_matches_latest_stats')
  }
}

if (failures.length > 0) {
  console.error('Catalog metadata validation failed:')
  failures.forEach((failure) => {
    console.error(`- ${failure}`)
  })
  process.exitCode = 1
} else {
  console.log('Catalog metadata validation passed.')
}
