import { expect, it } from 'vitest'
import { validateSnapshot } from './validate.js'

const validRepo = {
  html_url: 'https://github.com/Owner/Repo',
  stargazers_count: 12,
  forks_count: 0,
  subscribers_count: 3,
  description: null,
  owner: 'Owner',
  owner_url: 'https://github.com/Owner',
  repo_name: 'Repo',
  plugins_count: null,
  id: 7,
}
const validStats = [{ id: 5, date: '2026-01-01T00:00:00.000Z', size: 1 }]

it('accepts UTF-8 JSON preserving canonical case and null fields', () => {
  expect(() =>
    validateSnapshot(Buffer.from(`${JSON.stringify([validRepo])}\n`, 'utf8'), `${JSON.stringify(validStats)}\n`, {
      expectedSize: 1,
      requireLatestSize: true,
    }),
  ).not.toThrow()
})

it('reports issue count and paths for malformed records instead of silently dropping them', () => {
  const malformed = { ...validRepo, html_url: 'https://github.com/Owner/Repo?token=a', stargazers_count: -1, plugins_count: 1.5 }
  const extra = { ...validRepo, id: 8, repo_updated: 'internal' }
  expect(() => validateSnapshot(JSON.stringify([malformed, extra]), JSON.stringify(validStats))).toThrow(
    /4 issues.*repos\[0\]\.html_url.*repos\[0\]\.stargazers_count.*repos\[0\]\.plugins_count.*repos\[1\]\.repo_updated/s,
  )
})

it('keeps diagnostic paths but excludes arbitrary field names that could contain secrets', () => {
  const malformed = { ...validRepo, stargazers_count: -1, 'token-private-value': true }
  let thrown: unknown
  try {
    validateSnapshot(JSON.stringify([malformed]), JSON.stringify(validStats))
  } catch (error) {
    thrown = error
  }
  expect(thrown).toMatchObject({ count: 2, paths: ['repos[0]', 'repos[0].stargazers_count'] })
  expect(JSON.stringify((thrown as { paths: string[] }).paths)).not.toContain('token-private-value')
})

it('rejects wrong top-level shape and empty snapshots instead of returning empty success', () => {
  expect(() => validateSnapshot('{"rows":[]}', JSON.stringify(validStats))).toThrow(/repos.*array/i)
  expect(() => validateSnapshot('[]', JSON.stringify(validStats))).toThrow(/repos.*empty/i)
  expect(() => validateSnapshot(JSON.stringify([validRepo]), '[]')).toThrow(/stats.*empty/i)
  expect(() => validateSnapshot('not json', JSON.stringify(validStats))).toThrow(/repos.*JSON/i)
})

it('reports malformed stats paths, dates, ids and sizes, without requiring historical sizes to match today', () => {
  expect(() =>
    validateSnapshot(
      JSON.stringify([validRepo]),
      JSON.stringify([
        { id: 2, date: '2026-01-01T00:00:00.000Z', size: 0 },
        { id: 2, date: 'bad', size: -4 },
      ]),
    ),
  ).toThrow(/stats\[1\]\.id.*stats\[1\]\.date.*stats\[1\]\.size/s)
  expect(() => validateSnapshot(JSON.stringify([validRepo]), JSON.stringify([{ ...validStats[0], size: 0 }]))).not.toThrow()
})

it('rejects inconsistent catalog size and a mismatching latest stats draft when requested', () => {
  expect(() => validateSnapshot(JSON.stringify([validRepo]), JSON.stringify(validStats), { expectedSize: 2 })).toThrow(/repos.*size.*2/i)
  expect(() =>
    validateSnapshot(JSON.stringify([validRepo]), JSON.stringify([{ ...validStats[0], size: 2 }]), {
      requireLatestSize: true,
    }),
  ).toThrow(/stats\[0\]\.size.*repos.*1/i)
})

it('rejects malformed UTF-8 byte sequences and unpaired surrogate strings', () => {
  expect(() => validateSnapshot(Uint8Array.of(0xff), JSON.stringify(validStats))).toThrow(/repos.*UTF-8/i)
  expect(() => validateSnapshot(JSON.stringify([validRepo]), `[\ud800]`)).toThrow(/stats.*UTF-8/i)
})
