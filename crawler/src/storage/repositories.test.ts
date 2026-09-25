import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { openDatabase } from './db.js'
import * as repositoryStorage from './repositories.js'

const databases: Database.Database[] = []
const directories: string[] = []

function database() {
  const directory = mkdtempSync(join(import.meta.dirname, '.repositories-'))
  directories.push(directory)
  const db = openDatabase(join(directory, 'catalog.sqlite'))
  databases.push(db)
  return db
}

const enriched = {
  stargazers_count: 5,
  forks_count: 2,
  subscribers_count: 0,
  description: '123',
  owner: 'example',
  owner_url: 'https://github.com/example',
  repo_name: 'repo',
  repo_updated: '2025-03-01T09:00:00Z',
  plugins_count: 3,
  github_node_id: null,
  marketplace_oid: null,
  repository_etag: null,
  marketplace_etag: null,
  marketplace_parser_version: null,
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it('discovers case-insensitive GitHub URLs only once without resetting previously enriched data', () => {
  const { upsertDiscovery, updateEnriched } = repositoryStorage
  const db = database()
  db.prepare("INSERT INTO repositories (id, createdAt, updatedAt) VALUES (70, 'old', 'old')").run()
  const url = 'https://github.com/example/repo'
  const id = upsertDiscovery(db, url, 'discovery')
  expect(id).toBe(71)
  updateEnriched(db, id, enriched)
  expect(upsertDiscovery(db, url, 'new discovery')).toBe(id)
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 2 })
  expect(db.prepare('SELECT description, owner, stargazers_count FROM repositories WHERE id = ?').get(id)).toEqual({
    description: '123',
    owner: 'example',
    stargazers_count: 5,
  })
  const other = upsertDiscovery(db, 'https://github.com/Example/repo', 'different URL')
  expect(other).toBe(id)
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 2 })
})

it('refreshes the description of an unenriched discovered row without changing its id', () => {
  const { upsertDiscovery } = repositoryStorage
  const db = database()
  const url = 'https://github.com/example/repo'
  const id = upsertDiscovery(db, url, 'old description')
  const createdAt = db.prepare('SELECT createdAt FROM repositories WHERE id = ?').get(id)
  expect(upsertDiscovery(db, url, 'new description')).toBe(id)
  expect(db.prepare('SELECT id, description, createdAt FROM repositories WHERE html_url = ?').get(url)).toEqual({
    id,
    description: 'new description',
    ...(createdAt as { createdAt: string }),
  })
})

it('stores the GraphQL node ID from discovery and caches enrichment OIDs and ETags', () => {
  const { upsertDiscovery, updateEnriched } = repositoryStorage
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/example/repo', 'found', new Date().toISOString(), 'MDEwOlJlcG9zaXRvcnkx')
  updateEnriched(db, id, {
    ...enriched,
    github_node_id: 'MDEwOlJlcG9zaXRvcnkx',
    marketplace_oid: 'a'.repeat(40),
    repository_etag: '"repo-tag"',
    marketplace_etag: '"marketplace-tag"',
    marketplace_parser_version: 1,
  })

  expect(
    db
      .prepare(
        'SELECT github_node_id, marketplace_oid, repository_etag, marketplace_etag, marketplace_parser_version FROM repositories WHERE id = ?',
      )
      .get(id),
  ).toEqual({
    github_node_id: 'MDEwOlJlcG9zaXRvcnkx',
    marketplace_oid: 'a'.repeat(40),
    repository_etag: '"repo-tag"',
    marketplace_etag: '"marketplace-tag"',
    marketplace_parser_version: 1,
  })
})

it('refuses a blank discovery URL instead of creating a row with no identity', () => {
  const { upsertDiscovery } = repositoryStorage
  const db = database()
  expect(() => upsertDiscovery(db, '', null)).toThrow(/URL/)
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 0 })
})

it('updates a discovered row atomically, preserving its original id and URL', () => {
  const { upsertDiscovery, updateEnriched } = repositoryStorage
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/example/repo', 'old')
  expect(updateEnriched(db, id, enriched)).toBe(true)
  expect(db.prepare('SELECT * FROM repositories WHERE id = ?').get(id)).toMatchObject({
    id,
    html_url: 'https://github.com/example/repo',
    stargazers_count: 5,
    forks_count: 2,
    subscribers_count: 0,
    description: '123',
    owner: 'example',
    repo_name: 'repo',
    repo_updated: '2025-03-01T09:00:00Z',
    plugins_count: 3,
  })
  expect(updateEnriched(db, id + 500, enriched)).toBe(false)
})

it('rejects negative GitHub counts before modifying a previously enriched row', () => {
  const { upsertDiscovery, updateEnriched } = repositoryStorage
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/example/repo', null)
  updateEnriched(db, id, enriched)
  const before = db.prepare('SELECT * FROM repositories WHERE id = ?').get(id)
  expect(() => updateEnriched(db, id, { ...enriched, plugins_count: -1 })).toThrow(/plugins_count/)
  expect(() => updateEnriched(db, id, { ...enriched, stargazers_count: -3 })).toThrow(/stargazers_count/)
  expect(db.prepare('SELECT * FROM repositories WHERE id = ?').get(id)).toEqual(before)
})

it('pages by original id including imported rows without URLs and deletes by id', () => {
  const { deleteById, listForEnrichment, upsertDiscovery } = repositoryStorage
  const db = database()
  db.prepare("INSERT INTO repositories (id, html_url, createdAt, updatedAt) VALUES (12, NULL, 'old', 'old')").run()
  db.prepare("INSERT INTO repositories (id, html_url, createdAt, updatedAt) VALUES (58, NULL, 'old', 'old')").run()
  const last = upsertDiscovery(db, 'https://github.com/example/repo', null)
  expect(listForEnrichment(db, 0, 2).map((row) => row.id)).toEqual([12, 58])
  expect(listForEnrichment(db, 58, 2).map((row) => row.id)).toEqual([last])
  expect(() => listForEnrichment(db, 0, 0)).toThrow(/limit/)
  expect(deleteById(db, 58)).toBe(true)
  expect(deleteById(db, 58)).toBe(false)
  expect(listForEnrichment(db, 0, 10).map((row) => row.id)).toEqual([12, last])
})

it('publishes only complete canonical GitHub rows with the ten public columns', () => {
  const { listPublishable, upsertDiscovery, updateEnriched } = repositoryStorage
  const db = database()
  db.prepare("INSERT INTO repositories (id, createdAt, updatedAt) VALUES (1, 'old', 'old')").run()
  const valid = upsertDiscovery(db, 'https://github.com/example/repo', 'pending')
  updateEnriched(db, valid, enriched)
  const incomplete = upsertDiscovery(db, 'https://github.com/other/not-enriched', null)
  const badUrl = upsertDiscovery(db, 'https://github.com/example/repo?token=bad', null)
  updateEnriched(db, badUrl, enriched)
  const badOwnerUrl = upsertDiscovery(db, 'https://github.com/example/another', null)
  updateEnriched(db, badOwnerUrl, { ...enriched, repo_name: 'another', owner_url: 'https://evil.example/example' })

  expect(listPublishable(db)).toEqual([
    {
      id: valid,
      html_url: 'https://github.com/example/repo',
      stargazers_count: 5,
      forks_count: 2,
      subscribers_count: 0,
      description: '123',
      owner: 'example',
      owner_url: 'https://github.com/example',
      repo_name: 'repo',
      plugins_count: 3,
    },
  ])
  expect(incomplete).toBeGreaterThan(valid)
})

it('publishes canonical enriched rows with unknown plugin counts without leaking incomplete candidates', () => {
  const { listPublishable, upsertDiscovery, updateEnriched } = repositoryStorage
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/example/repo', null)
  updateEnriched(db, id, { ...enriched, plugins_count: null })
  expect(upsertDiscovery(db, 'https://github.com/example/repo', 'rediscovered')).toBe(id)
  db.prepare(`
    INSERT INTO repositories (id, html_url, plugins_count, createdAt, updatedAt)
    VALUES (9001, 'https://github.com/example/pending', NULL, 'created', 'updated')
  `).run()

  expect(listPublishable(db)).toEqual([
    {
      id,
      html_url: 'https://github.com/example/repo',
      stargazers_count: 5,
      forks_count: 2,
      subscribers_count: 0,
      description: '123',
      owner: 'example',
      owner_url: 'https://github.com/example',
      repo_name: 'repo',
      plugins_count: null,
    },
  ])
  expect(db.prepare('SELECT description FROM repositories WHERE id = ?').get(id)).toEqual({ description: '123' })
})

it('rejects dot-segment identities even when their stored URL matches the raw owner fields', () => {
  const { listPublishable, upsertDiscovery, updateEnriched } = repositoryStorage
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/../repo', null)
  updateEnriched(db, id, {
    ...enriched,
    owner: '..',
    owner_url: 'https://github.com/..',
  })
  expect(listPublishable(db)).toEqual([])
})
