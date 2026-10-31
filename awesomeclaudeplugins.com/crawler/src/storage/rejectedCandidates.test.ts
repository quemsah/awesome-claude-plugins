import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { isUnchangedRejectedCandidate, recordRejectedCandidate } from './rejectedCandidates.js'
import { initializeSchema } from './schema.js'

function database() {
  const db = new Database(':memory:')
  initializeSchema(db)
  return db
}

it('does not suppress a new GitHub node occupying a previously rejected URL', () => {
  const db = database()
  try {
    const url = 'https://github.com/example/marketplace'
    recordRejectedCandidate(db, url, 'node-old', '2026-10-30T12:00:00Z')
    expect(isUnchangedRejectedCandidate(db, url, 'node-new', '2026-10-29T11:00:00Z')).toBe(false)
    expect(isUnchangedRejectedCandidate(db, url, 'node-old', '2026-10-29T11:00:00Z')).toBe(true)
  } finally {
    db.close()
  }
})

it('retains URL fallback when either node ID is unknown', () => {
  const db = database()
  try {
    const url = 'https://github.com/example/marketplace'
    recordRejectedCandidate(db, url, null, '2026-10-30T12:00:00Z')
    expect(isUnchangedRejectedCandidate(db, url, 'node-new', '2026-10-29T11:00:00Z')).toBe(true)
    recordRejectedCandidate(db, url, 'node-old', '2026-10-30T12:00:00Z')
    expect(isUnchangedRejectedCandidate(db, url, undefined, '2026-10-29T11:00:00Z')).toBe(true)
  } finally {
    db.close()
  }
})

it('recognizes rejected repositories by node ID across URL changes', () => {
  const db = database()
  try {
    recordRejectedCandidate(db, 'https://github.com/example/old', 'node-stable', '2026-10-30T12:00:00Z')
    expect(isUnchangedRejectedCandidate(db, 'https://github.com/example/renamed', 'node-stable', '2026-10-29T11:00:00Z')).toBe(true)
  } finally {
    db.close()
  }
})
