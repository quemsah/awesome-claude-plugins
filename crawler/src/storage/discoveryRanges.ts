import type Database from 'better-sqlite3'
import type { SizeRange } from '../github/sizeRanges.js'

type DiscoveryRangeRow = {
  range_start: number
  range_end: number
}

function isExactPartition(root: SizeRange, ranges: readonly SizeRange[]): boolean {
  if (ranges.length === 0) return false
  const [rootStart, rootEnd] = root
  let nextStart = rootStart
  for (const [start, end] of ranges) {
    if (start !== nextStart || end < start || end > rootEnd) return false
    nextStart = end + 1
  }
  return nextStart === rootEnd + 1
}

export function listCachedDiscoveryRanges(db: Database.Database, root: SizeRange): SizeRange[] | null {
  const [rootStart, rootEnd] = root
  const rows = db
    .prepare(
      `SELECT range_start, range_end
       FROM discovery_ranges
       WHERE root_start = ? AND root_end = ?
       ORDER BY range_start, range_end`,
    )
    .all(rootStart, rootEnd) as DiscoveryRangeRow[]
  const ranges = rows.map(({ range_start, range_end }) => [range_start, range_end] as const)
  return isExactPartition(root, ranges) ? ranges : null
}

export function replaceCachedDiscoveryRanges(
  db: Database.Database,
  root: SizeRange,
  ranges: readonly SizeRange[],
): void {
  if (!isExactPartition(root, ranges)) throw new Error('Discovery ranges must exactly partition the root range')
  const [rootStart, rootEnd] = root
  const replace = () => {
    db.prepare('DELETE FROM discovery_ranges WHERE root_start = ? AND root_end = ?').run(rootStart, rootEnd)
    const insert = db.prepare(
      'INSERT INTO discovery_ranges (root_start, root_end, range_start, range_end) VALUES (?, ?, ?, ?)',
    )
    for (const [start, end] of ranges) insert.run(rootStart, rootEnd, start, end)
  }
  if (db.inTransaction) replace()
  else db.transaction(replace)()
}
