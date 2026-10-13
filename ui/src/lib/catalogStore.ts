import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Repo } from '../schemas/repo.schema.ts'

const CATALOG_KEY = Symbol.for('awesome-claude-plugins.catalog')

type CatalogGlobal = typeof globalThis & { [CATALOG_KEY]?: readonly Repo[] }

export function getCatalog(): readonly Repo[] {
  const root = globalThis as CatalogGlobal
  return (root[CATALOG_KEY] ??= JSON.parse(readFileSync(join(process.cwd(), 'src/data/repos.json'), 'utf8')) as Repo[])
}
