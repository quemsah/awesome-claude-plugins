import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = parseArgs(process.argv.slice(2))
const currentPath = args.current ?? 'src/data/repos.json'
const candidatePath = args.candidate ?? currentPath

const currentRepos = readJson(currentPath)
const candidateRepos = readJson(candidatePath)

const summary = {
  current: summarizeCatalog(currentRepos),
  candidate: summarizeCatalog(candidateRepos),
  diff: diffCatalogs(currentRepos, candidateRepos),
}

console.log(JSON.stringify(summary, null, 2))

function parseArgs(rawArgs) {
  const parsed = {}

  for (let index = 0; index < rawArgs.length; index++) {
    const arg = rawArgs[index]
    if (arg === '--current') {
      parsed.current = rawArgs[index + 1]
      index += 1
    } else if (arg === '--candidate') {
      parsed.candidate = rawArgs[index + 1]
      index += 1
    } else if (arg === '--help') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}

function printHelp() {
  console.log(`Usage: node scripts/catalog-update-summary.mjs [--current src/data/repos.json] [--candidate candidate-repos.json]

Compares catalog snapshots and prints a JSON summary of count deltas, changed rows, and data-quality warnings.`)
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'))
}

function summarizeCatalog(repos) {
  if (!Array.isArray(repos)) {
    return {
      repositoryCount: 0,
      pluginCount: 0,
      warnings: {
        invalidShape: ['Catalog is not an array'],
      },
    }
  }

  return {
    repositoryCount: repos.length,
    pluginCount: repos.reduce((total, repo) => total + (repo.plugins_count || 0), 0),
    warnings: getWarnings(repos),
  }
}

function diffCatalogs(currentRepos, candidateRepos) {
  if (!(Array.isArray(currentRepos) && Array.isArray(candidateRepos))) {
    return {
      added: [],
      removed: [],
      changed: [],
    }
  }

  const currentByUrl = new Map(currentRepos.map((repo) => [repo.html_url, repo]))
  const candidateByUrl = new Map(candidateRepos.map((repo) => [repo.html_url, repo]))

  const added = candidateRepos.filter((repo) => !currentByUrl.has(repo.html_url)).map(formatRepo)
  const removed = currentRepos.filter((repo) => !candidateByUrl.has(repo.html_url)).map(formatRepo)
  const changed = candidateRepos
    .filter((repo) => {
      const currentRepo = currentByUrl.get(repo.html_url)
      return currentRepo && JSON.stringify(currentRepo) !== JSON.stringify(repo)
    })
    .map(formatRepo)

  return {
    addedCount: added.length,
    removedCount: removed.length,
    changedCount: changed.length,
    added: added.slice(0, 25),
    removed: removed.slice(0, 25),
    changed: changed.slice(0, 25),
  }
}

function getWarnings(repos) {
  const ids = new Map()
  const urls = new Map()
  const warnings = {
    duplicateIds: [],
    duplicateUrls: [],
    invalidGitHubUrls: [],
    negativeCounts: [],
    nullPluginCounts: [],
    untrimmedDescriptions: [],
  }

  repos.forEach((repo, index) => {
    const label = formatRepo(repo, index)

    if (ids.has(repo.id)) {
      warnings.duplicateIds.push(`${label} duplicates row ${ids.get(repo.id)}`)
    } else {
      ids.set(repo.id, index)
    }

    if (urls.has(repo.html_url)) {
      warnings.duplicateUrls.push(`${label} duplicates row ${urls.get(repo.html_url)}`)
    } else {
      urls.set(repo.html_url, index)
    }

    if (typeof repo.html_url !== 'string' || !repo.html_url.startsWith('https://github.com/')) {
      warnings.invalidGitHubUrls.push(label)
    }

    for (const field of ['stargazers_count', 'forks_count', 'subscribers_count', 'plugins_count']) {
      if (repo[field] !== null && typeof repo[field] === 'number' && repo[field] < 0) {
        warnings.negativeCounts.push(`${label} ${field}=${repo[field]}`)
      }
    }

    if (repo.plugins_count === null) {
      warnings.nullPluginCounts.push(label)
    }

    if (typeof repo.description === 'string' && repo.description !== repo.description.trim()) {
      warnings.untrimmedDescriptions.push(label)
    }
  })

  return Object.fromEntries(
    Object.entries(warnings).map(([name, values]) => [
      name,
      {
        count: values.length,
        sample: values.slice(0, 25),
      },
    ])
  )
}

function formatRepo(repo, index) {
  const prefix = typeof index === 'number' ? `row ${index}` : 'repo'
  if (!repo || typeof repo !== 'object') {
    return `${prefix}: invalid`
  }

  return `${prefix}: ${repo.owner ?? 'unknown'}/${repo.repo_name ?? 'unknown'}#${repo.id ?? 'unknown'}`
}
