import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function validateCatalog({ repos, stats }) {
  const errors = []

  if (!Array.isArray(repos) || repos.length === 0) {
    errors.push('repos.json must be a non-empty array')
  }

  if (!Array.isArray(stats) || stats.length === 0) {
    errors.push('stats.json must be a non-empty array')
  }

  if (Array.isArray(repos) && Array.isArray(stats) && stats.length > 0) {
    const latestStat = stats.at(-1)
    if (!latestStat || latestStat.size !== repos.length) {
      errors.push(`latest stats size must match repository count ${repos.length}`)
    }
  }

  return errors
}

async function main() {
  const [repos, stats] = await Promise.all([readJson('src/data/repos.json'), readJson('src/data/stats.json')])
  const errors = validateCatalog({ repos, stats })

  if (errors.length > 0) {
    console.error(`Data validation failed with ${errors.length} error(s):`)
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  console.log(`Data validation passed for ${repos.length} repositories and ${stats.length} stats snapshots.`)
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(ROOT_DIR, path), 'utf8'))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
