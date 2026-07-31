import { readFileSync } from 'node:fs'

const repos = readJson('../src/data/repos.json')
const stats = readJson('../src/data/stats.json')
const allowlist = readJson('./data-validation-allowlist.json')

const failures = []
const notices = []

const MILLISECONDS_IN_DAY = 1000 * 60 * 60 * 24
const GITHUB_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/
const GITHUB_REPO_URL_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const GITHUB_OWNER_URL_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9._-]+$/

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'))
}

function addFailure(message) {
  failures.push(message)
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function validateAnomalyPolicy() {
  if (!Number.isInteger(allowlist.version) || allowlist.version < 1) {
    addFailure('Data-validation allowlist must have a positive integer version')
  }
  if (typeof allowlist.owner !== 'string' || allowlist.owner.trim().length === 0) {
    addFailure('Data-validation allowlist must identify an owner')
  }
  if (typeof allowlist.expiresAt !== 'string' || Number.isNaN(Date.parse(allowlist.expiresAt))) {
    addFailure('Data-validation allowlist must have a valid expiry date')
  } else if (new Date(allowlist.expiresAt) < new Date()) {
    addFailure(`Data-validation allowlist expired on ${allowlist.expiresAt}; review its anomaly policy`)
  }
}

function getKnownAnomaly(name) {
  const anomaly = allowlist.knownAnomalies?.[name]
  if (!anomaly) {
    addFailure(`Missing known-anomaly allowlist entry: ${name}`)
    return null
  }
  if (!Number.isInteger(anomaly.expectedCount) || anomaly.expectedCount < 0) {
    addFailure(`Known-anomaly allowlist entry ${name} must have a nonnegative integer expectedCount`)
    return null
  }
  if (!Number.isInteger(anomaly.maxCount) || anomaly.maxCount < anomaly.expectedCount) {
    addFailure(`Known-anomaly allowlist entry ${name} must have a maxCount ceiling of at least expectedCount`)
    return null
  }
  return anomaly
}

function reportKnownCount(name, actualCount, details) {
  const anomaly = getKnownAnomaly(name)
  if (!anomaly) return

  const ceiling = Number.isInteger(anomaly.maxCount) ? anomaly.maxCount : anomaly.expectedCount
  if (actualCount > ceiling) {
    addFailure(`${name}: ${actualCount} exceeds the tolerated ceiling of ${ceiling}. ${details}`)
    return
  }

  if (actualCount !== anomaly.expectedCount) {
    notices.push(`${name}: expected ${anomaly.expectedCount}, found ${actualCount}. ${details}`)
    return
  }

  if (actualCount > 0) {
    notices.push(`${name}: ${actualCount} tolerated. ${anomaly.reason}`)
  }
}

function formatSample(items, limit = 10) {
  return items.slice(0, limit).join(', ')
}

function validateRepos() {
  if (!Array.isArray(repos)) {
    addFailure('repos.json must contain an array')
    return
  }

  const seenIds = new Map()
  const seenUrls = new Map()
  const canonicalRepos = new Map()
  const nullPluginCountRows = []
  const untrimmedDescriptionRows = []

  function validateRepo(repo, index) {
    const label = `repos[${index}]`
    if (!isPlainObject(repo)) {
      addFailure(`${label} must be an object`)
      return
    }

    const rowLabel = `${label} id=${repo.id ?? 'unknown'}`

    if (!isPositiveInteger(repo.id)) {
      addFailure(`${rowLabel}: id must be a positive integer`)
    } else if (seenIds.has(repo.id)) {
      addFailure(`${rowLabel}: duplicate id also used by repos[${seenIds.get(repo.id)}]`)
    } else {
      seenIds.set(repo.id, index)
    }

    if (typeof repo.owner !== 'string' || !GITHUB_SEGMENT_PATTERN.test(repo.owner)) {
      addFailure(`${rowLabel}: owner must be a valid GitHub path segment`)
    }

    if (typeof repo.repo_name !== 'string' || !GITHUB_SEGMENT_PATTERN.test(repo.repo_name)) {
      addFailure(`${rowLabel}: repo_name must be a valid GitHub path segment`)
    }

    if (typeof repo.html_url !== 'string' || !GITHUB_REPO_URL_PATTERN.test(repo.html_url)) {
      addFailure(`${rowLabel}: html_url must be a GitHub repository URL`)
    } else if (seenUrls.has(repo.html_url)) {
      addFailure(`${rowLabel}: duplicate html_url also used by repos[${seenUrls.get(repo.html_url)}]`)
    } else {
      seenUrls.set(repo.html_url, index)
    }

    if (typeof repo.owner_url !== 'string' || !GITHUB_OWNER_URL_PATTERN.test(repo.owner_url)) {
      addFailure(`${rowLabel}: owner_url must be a GitHub owner URL`)
    }

    if (typeof repo.owner === 'string' && typeof repo.repo_name === 'string') {
      const expectedRepoUrl = `https://github.com/${repo.owner}/${repo.repo_name}`
      const expectedOwnerUrl = `https://github.com/${repo.owner}`

      if (repo.html_url !== expectedRepoUrl) {
        addFailure(`${rowLabel}: html_url must equal ${expectedRepoUrl}`)
      }

      if (repo.owner_url !== expectedOwnerUrl) {
        addFailure(`${rowLabel}: owner_url must equal ${expectedOwnerUrl}`)
      }

      const canonicalKey = `${repo.owner.toLowerCase()}/${repo.repo_name.toLowerCase()}`
      const existingRows = canonicalRepos.get(canonicalKey) ?? []
      existingRows.push(`${repo.owner}/${repo.repo_name}#${repo.id}`)
      canonicalRepos.set(canonicalKey, existingRows)
    }

    for (const countField of ['stargazers_count', 'forks_count', 'subscribers_count']) {
      if (!isNonnegativeInteger(repo[countField])) {
        addFailure(`${rowLabel}: ${countField} must be a nonnegative integer`)
      }
    }

    if (repo.plugins_count === null) {
      nullPluginCountRows.push(`${repo.owner}/${repo.repo_name}#${repo.id}`)
    } else if (!isNonnegativeInteger(repo.plugins_count)) {
      addFailure(`${rowLabel}: plugins_count must be null or a nonnegative integer`)
    }

    if (repo.description !== null && typeof repo.description !== 'string') {
      addFailure(`${rowLabel}: description must be null or a string`)
    } else if (typeof repo.description === 'string' && repo.description !== repo.description.trim()) {
      untrimmedDescriptionRows.push(`${repo.owner}/${repo.repo_name}#${repo.id}`)
    }
  }

  repos.forEach(validateRepo)

  const canonicalCollisionGroups = [...canonicalRepos.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([canonicalKey, rows]) => `${canonicalKey}: ${rows.join(' | ')}`)

  reportKnownCount('repositoriesWithNullPluginCount', nullPluginCountRows.length, `Sample: ${formatSample(nullPluginCountRows)}`)
  reportKnownCount(
    'repositoriesWithUntrimmedDescriptions',
    untrimmedDescriptionRows.length,
    `Sample: ${formatSample(untrimmedDescriptionRows)}`
  )
  reportKnownCount(
    'caseInsensitiveRepositoryCollisions',
    canonicalCollisionGroups.length,
    `Sample: ${formatSample(canonicalCollisionGroups, 5)}`
  )
}

function validateStats() {
  if (!Array.isArray(stats)) {
    addFailure('stats.json must contain an array')
    return
  }

  const seenIds = new Map()
  const duplicateDays = new Map()
  const gapRows = []
  const declineRows = []
  let previousDate = null
  let previousItem = null

  function validateStat(item, index) {
    const label = `stats[${index}]`
    if (!isPlainObject(item)) {
      addFailure(`${label} must be an object`)
      return
    }

    const rowLabel = `${label} id=${item.id ?? 'unknown'}`

    if (!isPositiveInteger(item.id)) {
      addFailure(`${rowLabel}: id must be a positive integer`)
    } else if (seenIds.has(item.id)) {
      addFailure(`${rowLabel}: duplicate id also used by stats[${seenIds.get(item.id)}]`)
    } else {
      seenIds.set(item.id, index)
    }

    if (typeof item.date !== 'string') {
      addFailure(`${rowLabel}: date must be an ISO datetime string`)
      return
    }

    const date = new Date(item.date)
    if (Number.isNaN(date.getTime()) || date.toISOString() !== item.date) {
      addFailure(`${rowLabel}: date must be a normalized ISO datetime string`)
      return
    }

    if (!isNonnegativeInteger(item.size)) {
      addFailure(`${rowLabel}: size must be a nonnegative integer`)
    }

    if (previousDate && date < previousDate) {
      addFailure(`${rowLabel}: date must be chronological after ${previousItem.date}`)
      return
    }

    if (previousDate) {
      const dayGap = (date.getTime() - previousDate.getTime()) / MILLISECONDS_IN_DAY
      if (dayGap > 1.5) {
        gapRows.push(`${previousItem.date} -> ${item.date} (${dayGap.toFixed(2)} days)`)
      }

      if (isNonnegativeInteger(item.size) && isNonnegativeInteger(previousItem.size) && item.size < previousItem.size) {
        declineRows.push(`${previousItem.date}:${previousItem.size} -> ${item.date}:${item.size}`)
      }
    }

    const utcDay = date.toISOString().slice(0, 10)
    const dayRows = duplicateDays.get(utcDay) ?? []
    dayRows.push(`${item.date}#${item.id}`)
    duplicateDays.set(utcDay, dayRows)

    previousDate = date
    previousItem = item
  }

  stats.forEach(validateStat)

  const duplicateDayRows = [...duplicateDays.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([day, rows]) => `${day}: ${rows.join(' | ')}`)

  reportKnownCount('statsGapsOverOneAndHalfDays', gapRows.length, `Sample: ${formatSample(gapRows, 5)}`)
  reportKnownCount('statsDuplicateUtcDays', duplicateDayRows.length, `Sample: ${formatSample(duplicateDayRows)}`)
  reportKnownCount('statsDeclines', declineRows.length, `Sample: ${formatSample(declineRows)}`)
}

validateAnomalyPolicy()
validateRepos()
validateStats()

if (failures.length > 0) {
  console.error('Data validation failed:')
  failures.forEach((failure) => {
    console.error(`- ${failure}`)
  })
  process.exitCode = 1
} else {
  console.log(`Data validation passed for ${repos.length} repositories and ${stats.length} stats snapshots.`)
  notices.forEach((notice) => {
    console.log(`- ${notice}`)
  })
}
