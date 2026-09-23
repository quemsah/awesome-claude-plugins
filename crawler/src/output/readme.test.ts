import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import type { PublishableRepository } from '../storage/repositories.js'
import { renderReadme } from './readme.js'

function repo(id: number, stars: number, subscribers: number | null, description: string | null = null): PublishableRepository {
  return {
    id,
    html_url: `https://github.com/owner/repo-${id}`,
    repo_name: `repo-${id}`,
    owner: 'owner',
    owner_url: 'https://github.com/owner',
    stargazers_count: stars,
    subscribers_count: subscribers,
    forks_count: 0,
    plugins_count: null,
    description,
  }
}

it('escapes table-breaking description characters without altering input or inventing backslashes', () => {
  const repositories = [repo(2, 4, null, 'A | slash \\| *bold*\n[link](url)'), repo(1, 9, 5)]
  const original = structuredClone(repositories)
  expect(renderReadme(repositories, { id: 304, date: '2026-09-23T23:59:59.999Z', size: 2 })).toBe(
    '# Awesome Claude Code Plugins: Top 100 Repositories\n\n' +
      '> Last updated: 23.09.2026 with 2 total repositories indexed.\n\n' +
      '| # | Repo Name | Description | Stars | Subs | Plugins |\n' +
      '|---|-----------|-------------|-------|-------------|---------|\n' +
      '| 1 | [repo-1](https://github.com/owner/repo-1) |  | 9 | 5 | 0 |\n' +
      '| 2 | [repo-2](https://github.com/owner/repo-2) | A &#124; slash &#92;&#124; *bold* [link](url) | 4 | 0 | 0 |\n',
  )
  expect(repositories).toEqual(original)
})

it('uses the draft timestamp in UTC across midnight and rejects a mismatched catalog size', () => {
  const repositories = [repo(1, 1, 1)]
  expect(renderReadme(repositories, { id: 304, date: '2027-01-01T00:00:00.000Z', size: 1 })).toContain(
    '> Last updated: 01.01.2027 with 1 total repositories indexed.',
  )
  expect(() => renderReadme(repositories, { id: 304, date: '2027-01-01T00:00:00.000Z', size: 2 })).toThrow(/catalog size/i)
})

it.each(['not-a-date', '2026-09-23T21:00:00+03:00', '2026-02-30T00:00:00.000Z'])(
  'rejects invalid or non-UTC draft timestamps instead of rendering a misleading date: %s',
  (date) => {
    expect(() => renderReadme([repo(1, 1, 1)], { id: 304, date, size: 1 })).toThrow(/draft date.*ISO UTC/i)
  },
)

it('sorts stars, subscribers, then ascending original ID, taking at most 100 even for equal scores', () => {
  const repositories = Array.from({ length: 102 }, (_, index) => repo(102 - index, 10, 2))
  repositories.push(repo(104, 11, 0), repo(103, 10, 3))
  const markdown = renderReadme(repositories, { id: 304, date: '2026-09-23T00:00:00.000Z', size: 104 })
  const ids = [...markdown.matchAll(/^\| \d+ \| \[repo-(\d+)\]\(/gm)].map((match) => Number(match[1]))
  expect(ids).toHaveLength(100)
  expect(ids.slice(0, 5)).toEqual([104, 103, 1, 2, 3])
  expect(ids.at(-1)).toBe(98)
})

it('renders an empty catalog without ranked rows', () => {
  const markdown = renderReadme([], { id: 304, date: '2026-09-23T00:00:00.000Z', size: 0 })
  expect(markdown).toContain('with 0 total repositories indexed.')
  expect([...markdown.matchAll(/^\| \d+ \| /gm)]).toHaveLength(0)
})

it('matches all 100 legacy ranked links from the unchanged published UI snapshot', () => {
  const repositories = JSON.parse(
    readFileSync(new URL('../../../ui/src/data/repos.json', import.meta.url), 'utf8'),
  ) as PublishableRepository[]
  const legacy = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8')
  const links = (text: string) =>
    [...text.matchAll(/^\| \d+ \| \[[^\]]+\]\((https:\/\/github\.com\/[^)]+)\) \|/gm)].map((match) => match[1])
  const expectedLinks = links(legacy)
  expect(expectedLinks).toHaveLength(100)
  expect(links(renderReadme(repositories, { id: 304, date: '2026-09-22T08:12:33.125Z', size: repositories.length }))).toEqual(expectedLinks)
})
