/** biome-ignore-all lint/style/useNamingConvention: report mirrors catalog snake_case fields */
import { readFileSync } from 'node:fs'

const checkOnly = process.argv.includes('--check')
const repos = readJson('../src/data/repos.json')
const lifecycle = readJson('../src/data/repo-lifecycle.json')
const lifecycleStatuses = new Set(['active', 'archived', 'deleted', 'fork', 'mirror', 'renamed', 'stale', 'case_collision'])
const report = buildLifecycleReport()

console.log(JSON.stringify(report, null, 2))

if (checkOnly && report.validation.errors.length > 0) {
  process.exitCode = 1
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'))
}

function buildLifecycleReport() {
  const validRepos = repos.filter((repo) => repo.owner && repo.repo_name)
  const reposBySlug = new Map(validRepos.map((repo) => [getSlug(repo), repo]))
  const lifecycleRecords = lifecycle.repositories ?? []
  const recordsBySlug = new Map(lifecycleRecords.map((record) => [record.slug, record]))
  const caseCollisionGroups = getCaseCollisionGroups(validRepos)
  const validationErrors = []

  for (const record of lifecycleRecords) {
    if (!(record.slug && record.status)) {
      validationErrors.push(`Lifecycle record is missing slug or status: ${JSON.stringify(record)}`)
      continue
    }

    if (!lifecycleStatuses.has(record.status)) {
      validationErrors.push(`Lifecycle record for ${record.slug} has unknown status: ${record.status}`)
    }

    if (!reposBySlug.has(record.slug)) {
      validationErrors.push(`Lifecycle record references an unknown catalog slug: ${record.slug}`)
    }

    if ((record.status === 'renamed' || record.status === 'case_collision') && !record.canonical_slug) {
      validationErrors.push(`Lifecycle record for ${record.slug} must include canonical_slug`)
    }

    if (record.status === 'case_collision' && record.canonical_slug && !reposBySlug.has(record.canonical_slug)) {
      validationErrors.push(`Case collision record for ${record.slug} references an unknown canonical slug: ${record.canonical_slug}`)
    }
  }

  for (const group of caseCollisionGroups) {
    const canonical = chooseCanonicalSlug(group)
    const missingDeclarations = group.filter(
      (repo) => getSlug(repo) !== canonical && recordsBySlug.get(getSlug(repo))?.canonical_slug !== canonical
    )

    for (const repo of missingDeclarations) {
      validationErrors.push(
        `Case collision ${getSlug(repo).toLowerCase()} is missing canonical declaration for ${getSlug(repo)} -> ${canonical}`
      )
    }
  }

  return {
    generated_at: new Date().toISOString(),
    catalog: {
      repositories: repos.length,
      valid_slugs: validRepos.length,
    },
    lifecycle: {
      declared_records: lifecycleRecords.length,
      declared_by_status: countBy(lifecycleRecords, (record) => record.status),
      detected_by_field: {
        archived: validRepos.filter((repo) => repo.archived).map(getSlug),
        deleted: validRepos.filter((repo) => repo.deleted).map(getSlug),
        forks: validRepos.filter((repo) => repo.fork).map(getSlug),
        mirrors: validRepos.filter((repo) => repo.mirror_url).map(getSlug),
        renamed: lifecycleRecords.filter((record) => record.status === 'renamed').map((record) => record.slug),
        stale: lifecycleRecords.filter((record) => record.status === 'stale').map((record) => record.slug),
      },
    },
    canonicalization: {
      case_collision_groups: caseCollisionGroups.map((group) => ({
        canonical_slug: chooseCanonicalSlug(group),
        variants: group.map(getSlug),
      })),
    },
    validation: {
      ok: validationErrors.length === 0,
      errors: validationErrors,
    },
  }
}

function getCaseCollisionGroups(validRepos) {
  const groups = new Map()

  for (const repo of validRepos) {
    const normalizedSlug = getSlug(repo).toLowerCase()
    const group = groups.get(normalizedSlug) ?? new Map()
    group.set(getSlug(repo), repo)
    groups.set(normalizedSlug, group)
  }

  return [...groups.values()].map((group) => [...group.values()]).filter((group) => group.length > 1)
}

function chooseCanonicalSlug(group) {
  return [...group]
    .sort(
      (a, b) =>
        (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0) ||
        (b.subscribers_count ?? 0) - (a.subscribers_count ?? 0) ||
        (b.plugins_count ?? 0) - (a.plugins_count ?? 0) ||
        a.id - b.id ||
        getSlug(a).localeCompare(getSlug(b))
    )
    .map(getSlug)[0]
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item)
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
}

function getSlug(repo) {
  return `${repo.owner}/${repo.repo_name}`
}
