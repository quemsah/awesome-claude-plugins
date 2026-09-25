import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { initializeSchema } from './schema.js'
import { listCachedDiscoveryRanges, replaceCachedDiscoveryRanges } from './discoveryRanges.js'

const databases: Database.Database[] = []

function database(): Database.Database {
  const db = new Database(':memory:')
  initializeSchema(db)
  databases.push(db)
  return db
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

it('keeps cached partitions isolated for overlapping root ranges', () => {
  const db = database()
  replaceCachedDiscoveryRanges(db, [0, 3], [
    [0, 1],
    [2, 3],
  ])
  replaceCachedDiscoveryRanges(db, [2, 5], [
    [2, 2],
    [3, 5],
  ])

  expect(listCachedDiscoveryRanges(db, [0, 3])).toEqual([
    [0, 1],
    [2, 3],
  ])
  expect(listCachedDiscoveryRanges(db, [2, 5])).toEqual([
    [2, 2],
    [3, 5],
  ])
})

it('ignores a cached partition unless it covers the root exactly', () => {
  const db = database()
  db.prepare(
    'INSERT INTO discovery_ranges (root_start, root_end, range_start, range_end) VALUES (0, 3, 0, 1)',
  ).run()

  expect(listCachedDiscoveryRanges(db, [0, 3])).toBeNull()
})
