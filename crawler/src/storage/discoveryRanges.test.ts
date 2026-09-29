import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { discoverySearchFamilies } from '../github/searchFamilies.js'
import type { SizeRange } from '../github/sizeRanges.js'
import { listCachedDiscoveryRanges, replaceCachedDiscoveryRanges } from './discoveryRanges.js'
import { initializeSchema } from './schema.js'

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
  replaceCachedDiscoveryRanges(
    db,
    'marketplace_filename_path',
    [0, 3],
    [
      [0, 1],
      [2, 3],
    ],
  )
  replaceCachedDiscoveryRanges(
    db,
    'marketplace_filename_path',
    [2, 5],
    [
      [2, 2],
      [3, 5],
    ],
  )

  expect(listCachedDiscoveryRanges(db, 'marketplace_filename_path', [0, 3])).toEqual([
    [0, 1],
    [2, 3],
  ])
  expect(listCachedDiscoveryRanges(db, 'marketplace_filename_path', [2, 5])).toEqual([
    [2, 2],
    [3, 5],
  ])
})

it('ignores a cached partition unless it covers the root exactly', () => {
  const db = database()
  db.prepare(
    'INSERT INTO discovery_ranges (query_family, root_start, root_end, range_start, range_end) VALUES (?, 0, 3, 0, 1)',
  ).run('marketplace_filename_path')

  expect(listCachedDiscoveryRanges(db, 'marketplace_filename_path', [0, 3])).toBeNull()
})

it('keeps partitions independent for each query family with the same root', () => {
  const db = database()
  const root: SizeRange = [0, 3]
  const primary = discoverySearchFamilies[0].queryFamily
  const literal = discoverySearchFamilies[1].queryFamily

  replaceCachedDiscoveryRanges(db, primary, root, [
    [0, 1],
    [2, 3],
  ])
  replaceCachedDiscoveryRanges(db, literal, root, [
    [0, 0],
    [1, 3],
  ])

  expect(listCachedDiscoveryRanges(db, primary, root)).toEqual([
    [0, 1],
    [2, 3],
  ])
  expect(listCachedDiscoveryRanges(db, literal, root)).toEqual([
    [0, 0],
    [1, 3],
  ])

  replaceCachedDiscoveryRanges(db, literal, root, [root])
  expect(listCachedDiscoveryRanges(db, primary, root)).toEqual([
    [0, 1],
    [2, 3],
  ])
})
