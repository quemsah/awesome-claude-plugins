/** biome-ignore-all lint/style/useNamingConvention: catalog data uses snake_case fields */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function splitCatalog(dataDir, numShards = 100) {
  const reposPath = join(dataDir, 'repos.json')
  const repos = JSON.parse(readFileSync(reposPath, 'utf8'))

  const fields = [
    'id',
    'owner',
    'repo_name',
    'stars',
    'forks',
    'plugins_count',
    'pushed_at',
    'license',
    'archived',
    'catalog_added_at',
    'tokens',
    'has_desc',
  ]

  const rows = repos.map((r) => {
    const tokens = r.plugins
      ? r.plugins
          .map((p) => p.name)
          .filter(
            (n) => Boolean(n) && n.toLowerCase() !== (r.repo_name || '').toLowerCase() && n.toLowerCase() !== (r.owner || '').toLowerCase()
          )
          .slice(0, 3)
      : []
    return [
      r.id,
      r.owner,
      r.repo_name,
      r.stargazers_count ?? 0,
      r.forks_count ?? 0,
      r.plugins_count ?? null,
      r.pushed_at ? r.pushed_at.slice(0, 10) : null,
      r.license ?? null,
      r.archived ? 1 : 0,
      r.catalog_added_at ? r.catalog_added_at.slice(0, 10) : null,
      tokens.length > 0 ? tokens : null,
      r.description && r.description.trim().length > 0 ? 1 : 0,
    ]
  })

  const searchIndex = { format: 'v1', fields, rows }
  const searchIndexPath = join(dataDir, 'search-index.json')
  writeFileSync(searchIndexPath, JSON.stringify(searchIndex))
  const indexSizeMb = (statSync(searchIndexPath).size / 1024 / 1024).toFixed(2)
  console.log(`Wrote search-index.json (${indexSizeMb} MB)`)

  const detailsDir = join(dataDir, 'repo-details')
  if (!existsSync(detailsDir)) {
    mkdirSync(detailsDir, { recursive: true })
  }

  const shards = {}
  for (let i = 0; i < numShards; i++) {
    shards[i] = {}
  }

  for (const r of repos) {
    const shardId = Math.abs(r.id % numShards)
    shards[shardId][r.id] = {
      description: r.description ?? null,
      plugins: r.plugins ?? [],
      subscribers_count: r.subscribers_count ?? null,
      catalog_updated_at: r.catalog_updated_at,
      pushed_at: r.pushed_at ?? null,
      catalog_added_at: r.catalog_added_at ?? null,
      license: r.license ?? null,
    }
  }

  for (let i = 0; i < numShards; i++) {
    writeFileSync(join(detailsDir, `${i}.json`), JSON.stringify(shards[i]))
  }
  console.log(`Wrote ${numShards} shards into ${detailsDir}`)
}

const dataDir = join(process.cwd(), 'src/data')
splitCatalog(dataDir)
