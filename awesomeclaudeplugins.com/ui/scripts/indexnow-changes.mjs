import { createHash } from 'node:crypto'

export function fingerprintCatalog(repos) {
  return createHash('sha256').update(JSON.stringify(repos)).digest('hex')
}

export function buildCatalogRecords(repos, siteUrl) {
  if (!Array.isArray(repos)) throw new Error('Catalog snapshot must be an array.')
  const seenPaths = new Set()
  const records = new Map()
  for (const repo of repos) {
    if (typeof repo?.owner !== 'string' || typeof repo.repo_name !== 'string') continue
    const key = `${repo.owner}/${repo.repo_name}`.toLowerCase()
    if (seenPaths.has(key)) continue
    seenPaths.add(key)
    if (repo.plugins_count === null) continue
    const url = new URL(`/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo_name)}`, siteUrl).toString()
    const fingerprint = fingerprintCatalog(repo)
    records.set(key, { fingerprint, url })
  }
  return records
}

export function diffCatalogRecords(previous, current) {
  const changedUrls = []
  const retiredUrls = []
  for (const [key, record] of current) {
    const old = previous.get(key)
    if (!old || old.fingerprint !== record.fingerprint || old.url !== record.url) changedUrls.push(record.url)
  }
  // Retire deleted, noindexed, or renamed-casing URLs too. They can now return 404,
  // redirect or noindex, so don't require a 200 response for retired URLs.
  for (const [key, old] of previous) {
    if (!current.has(key) || current.get(key).url !== old.url) retiredUrls.push(old.url)
  }
  return { changedUrls, retiredUrls }
}
