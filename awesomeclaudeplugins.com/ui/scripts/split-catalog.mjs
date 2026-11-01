/** biome-ignore-all lint/style/useNamingConvention: catalog data uses snake_case fields */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildRepoDetailsShards, buildSearchIndex } from '../../crawler/src/output/splitCatalog.ts'

export function splitCatalog(dataDir) {
  const repos = JSON.parse(readFileSync(join(dataDir, 'repos.json'), 'utf8'))
  const searchIndexPath = join(dataDir, 'search-index.json')
  writeFileSync(searchIndexPath, buildSearchIndex(repos))
  console.log(`Wrote search-index.json (${(statSync(searchIndexPath).size / 1024 / 1024).toFixed(2)} MB)`)

  const detailsDir = join(dataDir, 'repo-details')
  mkdirSync(detailsDir, { recursive: true })
  const shards = buildRepoDetailsShards(repos)
  for (const [name, content] of Object.entries(shards)) {
    writeFileSync(join(detailsDir, name), content)
  }
  console.log(`Wrote ${Object.keys(shards).length} shards into ${detailsDir}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  splitCatalog(join(process.cwd(), 'src/data'))
}
