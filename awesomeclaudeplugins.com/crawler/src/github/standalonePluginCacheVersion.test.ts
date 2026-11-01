import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { STANDALONE_PLUGIN_PARSER_VERSION } from './standalonePlugin.js'

it('invalidates standalone validators when the shared parser changes', () => {
  const bytes = Buffer.from(
    readFileSync(new URL('../../../shared/catalog-contract/src/standalonePlugin.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n'),
  )
  const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  const versions: Record<number, string> = { 1: '5ea13637c34495ef21c01d393eb40f40a7db14fb' }
  expect(hash).toBe(versions[STANDALONE_PLUGIN_PARSER_VERSION])
})
