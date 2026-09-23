import { expect, it } from 'vitest'
import type { PublishableRepository } from '../storage/repositories.js'
import { renderReadme } from './readme.js'
import { validateReadme } from './validateReadme.js'

const draft = { id: 265, date: '2026-09-23T12:00:00.000Z', size: 2 }
const repos: PublishableRepository[] = [
  {
    id: 1,
    html_url: 'https://github.com/owner/first',
    stargazers_count: 1,
    forks_count: 0,
    subscribers_count: 1,
    description: 'Some | pipes and \\| escapes\nnewlines',
    owner: 'owner',
    owner_url: 'https://github.com/owner',
    repo_name: 'first',
    plugins_count: 0,
  },
  {
    id: 2,
    html_url: 'https://github.com/owner/second',
    stargazers_count: 5,
    forks_count: 0,
    subscribers_count: 1,
    description: 'plain',
    owner: 'owner',
    owner_url: 'https://github.com/owner',
    repo_name: 'second',
    plugins_count: 0,
  },
]

it('accepts escaped descriptions while checking the top ranked links', () => {
  expect(() => validateReadme(renderReadme(repos, draft), repos, draft)).not.toThrow()
})

it('rejects README links with invalid GitHub identity segments', () => {
  const invalidRepos: PublishableRepository[] = [
    {
      ...repos[0],
      html_url: 'https://github.com/../first',
      owner: '..',
      owner_url: 'https://github.com/..',
    },
  ]
  const invalidDraft = { ...draft, size: 1 }

  expect(() => validateReadme(renderReadme(invalidRepos, invalidDraft), invalidRepos, invalidDraft)).toThrow(/top-100 links/)
})

it.each([
  ['heading', (text: string) => text.replace('Top 100 Repositories', 'Top 10 Repositories')],
  ['size', (text: string) => text.replace('with 2 total', 'with 1 total')],
  ['date', (text: string) => text.replace('23.09.2026', '22.09.2026')],
  ['missing row', (text: string) => text.replace(/^\| 2 \| \[first\].*\n/m, '')],
  ['rank', (text: string) => text.replace('| 1 | [second]', '| 2 | [second]')],
  ['description escaping', (text: string) => text.replace('&#92;&#124;', '\\&#124;')],
])('rejects a README with an incorrect %s before Git publication', (_name, modify) => {
  expect(() => validateReadme(modify(renderReadme(repos, draft)), repos, draft)).toThrow()
})
