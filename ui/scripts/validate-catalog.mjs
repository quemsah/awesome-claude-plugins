import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function validateCatalog({ repos, stats }) {
  const errors = [...validateRepos(repos), ...validateStats(stats)]

  if (Array.isArray(repos) && Array.isArray(stats)) {
    const latestStat = stats.at(-1)
    if (latestStat && latestStat.size !== repos.length) {
      errors.push(`stats latest size ${latestStat.size} does not match repo count ${repos.length}`)
    }
  }

  return errors
}

export function validateRepos(repos) {
  const errors = []

  if (!Array.isArray(repos) || repos.length === 0) {
    return ['repos.json must be a non-empty array']
  }

  const seenIds = new Set()

  repos.forEach((repo, index) => {
    const path = `repos[${index}]`

    if (!isRecord(repo)) {
      errors.push(`${path} must be an object`)
      return
    }

    validateRequiredUrl(errors, repo.html_url, `${path}.html_url`)
    validateNullableUrl(errors, repo.owner_url, `${path}.owner_url`)
    validateNullableString(errors, repo.description, `${path}.description`)
    validateNullableString(errors, repo.owner, `${path}.owner`)
    validateNullableString(errors, repo.repo_name, `${path}.repo_name`)
    validateNullableNumber(errors, repo.stargazers_count, `${path}.stargazers_count`)
    validateNullableNumber(errors, repo.forks_count, `${path}.forks_count`)
    validateNullableNumber(errors, repo.subscribers_count, `${path}.subscribers_count`)
    validateNullableNumber(errors, repo.plugins_count, `${path}.plugins_count`)

    if (!Number.isInteger(repo.id)) {
      errors.push(`${path}.id must be an integer`)
    } else if (seenIds.has(repo.id)) {
      errors.push(`${path}.id duplicates ${repo.id}`)
    } else {
      seenIds.add(repo.id)
    }
  })

  return errors
}

export function validateStats(stats) {
  const errors = []

  if (!Array.isArray(stats) || stats.length === 0) {
    return ['stats.json must be a non-empty array']
  }

  const seenIds = new Set()

  stats.forEach((entry, index) => {
    const path = `stats[${index}]`

    if (!isRecord(entry)) {
      errors.push(`${path} must be an object`)
      return
    }

    if (!Number.isInteger(entry.id)) {
      errors.push(`${path}.id must be an integer`)
    } else if (seenIds.has(entry.id)) {
      errors.push(`${path}.id duplicates ${entry.id}`)
    } else {
      seenIds.add(entry.id)
    }

    if (!Number.isInteger(entry.size) || entry.size < 0) {
      errors.push(`${path}.size must be a non-negative integer`)
    }

    if (typeof entry.date !== 'string' || Number.isNaN(Date.parse(entry.date))) {
      errors.push(`${path}.date must be an ISO date string`)
    }
  })

  return errors
}

async function main() {
  const [repos, stats] = await Promise.all([readJson('src/data/repos.json'), readJson('src/data/stats.json')])
  const errors = validateCatalog({ repos, stats })

  if (errors.length > 0) {
    console.error(`Catalog validation failed with ${errors.length} error(s):`)
    for (const error of errors.slice(0, 25)) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  console.log(`Catalog validation passed for ${repos.length} repositories and ${stats.length} stats snapshots.`)
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(ROOT_DIR, path), 'utf8'))
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateRequiredUrl(errors, value, path) {
  if (typeof value !== 'string' || !isUrl(value)) {
    errors.push(`${path} must be a URL string`)
  }
}

function validateNullableUrl(errors, value, path) {
  if (value !== null && (typeof value !== 'string' || !isUrl(value))) {
    errors.push(`${path} must be a URL string or null`)
  }
}

function validateNullableString(errors, value, path) {
  if (value !== null && typeof value !== 'string') {
    errors.push(`${path} must be a string or null`)
  }
}

function validateNullableNumber(errors, value, path) {
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    errors.push(`${path} must be a non-negative number or null`)
  }
}

function isUrl(value) {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
