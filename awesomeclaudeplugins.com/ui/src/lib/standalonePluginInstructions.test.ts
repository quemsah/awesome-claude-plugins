import { expect, it } from 'vitest'
import { getStandalonePluginLoadInstructions } from './standalonePluginInstructions.ts'

it('loads a validated repository checkout for one session', () => {
  expect(getStandalonePluginLoadInstructions('acme', 'reviewer')).toBe(
    'git clone https://github.com/acme/reviewer.git ./reviewer\nclaude --plugin-dir ./reviewer'
  )
})

it.each([
  ['acme;evil', 'repo'],
  ['acme', '../repo'],
  [null, 'repo'],
])('does not put unsafe identity in shell instructions', (owner, repo) => {
  expect(getStandalonePluginLoadInstructions(owner, repo)).toBeNull()
})
