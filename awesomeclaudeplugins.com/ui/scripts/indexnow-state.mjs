/** Pure, testable IndexNow state persistence and network submission helpers. */
export function deserializeBaseline(json) {
  const baseline = JSON.parse(json)
  if (
    !baseline ||
    typeof baseline !== 'object' ||
    baseline.version !== 1 ||
    !baseline.records ||
    typeof baseline.records !== 'object' ||
    Array.isArray(baseline.records)
  ) {
    throw new Error('Invalid IndexNow baseline; run workflow_dispatch with mode=full to replace it.')
  }
  const records = new Map()
  for (const [key, record] of Object.entries(baseline.records)) {
    if (!record || typeof record.fingerprint !== 'string' || !record.fingerprint || typeof record.url !== 'string' || !record.url) {
      throw new Error(`Invalid IndexNow baseline record for ${key}; run mode=full to replace it.`)
    }
    records.set(key, record)
  }
  return records
}

export function serializeBaseline(records, includedUrls = null) {
  const filtered = [...records].filter(([, record]) => includedUrls === null || includedUrls.has(record.url))
  return `${JSON.stringify({ version: 1, records: Object.fromEntries(filtered) })}\n`
}

export async function sendIndexNowBatch(urls, { siteUrl, key, keyLocation }, fetcher = fetch) {
  const response = await fetcher('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(siteUrl).host, key, keyLocation, urlList: urls }),
  })
  if (!response.ok) {
    const details = await response.text()
    throw new Error(`IndexNow rejected the request: ${response.status} ${response.statusText}${details ? ` - ${details}` : ''}`)
  }
}
