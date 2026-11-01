import { PublishedRepoSchema } from '@awesome-claude-plugins/catalog-contract'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { renderRepos } from '../output/catalogSnapshot.js'
import { isUnchangedRejectedCandidate } from './rejectedCandidates.js'
import { listPublishable, updateEnriched, upsertDiscovery } from './repositories.js'
import { initializeSchema } from './schema.js'

it('publishes standalone provenance and clears cache validators on kind transitions', () => {
  const db = new Database(':memory:')
  try {
    initializeSchema(db)
    const id = upsertDiscovery(db, 'https://github.com/acme/reviewer', null)
    const fields = {
      owner: 'acme',
      owner_url: 'https://github.com/acme',
      repo_name: 'reviewer',
      description: null,
      stargazers_count: 0,
      forks_count: 0,
      subscribers_count: 0,
      repo_updated: '2026-01-01T00:00:00Z',
      plugins_count: 1,
      plugins_json: '[{"name":"reviewer"}]',
    }
    updateEnriched(db, id, { ...fields, marketplace_etag: 'market-etag', marketplace_oid: 'market-oid' })
    updateEnriched(db, id, {
      ...fields,
      manifest_kind: 'standalone-plugin',
      plugin_manifest_etag: 'plugin-etag',
      plugin_manifest_parser_version: 1,
    })
    const published = JSON.parse(renderRepos(listPublishable(db)))[0]
    expect(published.manifest_kind).toBe('standalone-plugin')
    expect(PublishedRepoSchema.safeParse(published).success).toBe(true)
    expect(PublishedRepoSchema.safeParse({ ...published, manifest_kind: 'other' }).success).toBe(false)
    expect(db.prepare('SELECT marketplace_etag, marketplace_oid FROM repositories WHERE id = ?').get(id)).toEqual({
      marketplace_etag: null,
      marketplace_oid: null,
    })
    updateEnriched(db, id, { ...fields, manifest_kind: 'standalone-plugin', plugin_manifest_etag: null, plugin_manifest_parser_version: 1 })
    expect(db.prepare('SELECT plugin_manifest_etag FROM repositories WHERE id = ?').get(id)).toEqual({ plugin_manifest_etag: null })
    updateEnriched(db, id, { ...fields, manifest_kind: 'marketplace', marketplace_etag: 'new' })
    expect(db.prepare('SELECT plugin_manifest_etag, plugin_manifest_parser_version FROM repositories WHERE id = ?').get(id)).toEqual({
      plugin_manifest_etag: null,
      plugin_manifest_parser_version: null,
    })
    expect(JSON.parse(renderRepos(listPublishable(db)))[0]).not.toHaveProperty('manifest_kind')
  } finally {
    db.close()
  }
})

it('rechecks legacy rejections without requiring a new push', () => {
  const db = new Database(':memory:')
  try {
    initializeSchema(db)
    db.prepare('INSERT INTO rejected_repository_candidates (html_url, rejected_at) VALUES (?, ?)').run(
      'https://github.com/acme/reviewer',
      '2026-11-01T00:00:00Z',
    )
    expect(isUnchangedRejectedCandidate(db, 'https://github.com/acme/reviewer', null, null, '2026-11-01T01:00:00Z')).toBe(false)
  } finally {
    db.close()
  }
})

it('upgrades populated v21 data without changing timestamps or search checkpoints', () => {
  const db = new Database(':memory:')
  try {
    initializeSchema(db)
    db.exec(`DROP TRIGGER repositories_manifest_kind_timestamp_after_update;
      ALTER TABLE repositories DROP COLUMN manifest_kind;
      ALTER TABLE repositories DROP COLUMN plugin_manifest_etag;
      ALTER TABLE repositories DROP COLUMN plugin_manifest_parser_version;
      ALTER TABLE rejected_repository_candidates DROP COLUMN eligibility_version;
      INSERT INTO repositories (html_url, plugins_count, plugins_json, catalog_updated_at, createdAt, updatedAt)
      VALUES ('https://github.com/acme/old', 2, '[{"name":"old"}]', '2020-01-01T00:00:00.000Z', 'first', 'last');
      INSERT INTO discovery_ranges VALUES ('marketplace_filename_path', 0, 400000, 0, 200);
      PRAGMA user_version = 21;`)
    initializeSchema(db)
    initializeSchema(db)
    expect(db.pragma('user_version', { simple: true })).toBe(22)
    expect(
      db.prepare('SELECT id, plugins_count, plugins_json, catalog_updated_at, createdAt, manifest_kind FROM repositories').get(),
    ).toEqual({
      id: 1,
      plugins_count: 2,
      plugins_json: '[{"name":"old"}]',
      catalog_updated_at: '2020-01-01T00:00:00.000Z',
      createdAt: 'first',
      manifest_kind: null,
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM discovery_ranges').get()).toEqual({ count: 1 })
  } finally {
    db.close()
  }
})
