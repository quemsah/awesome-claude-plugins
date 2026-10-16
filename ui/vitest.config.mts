import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const realCatalogTests = [
  'src/app/api/catalog/contract.test.ts',
  'src/lib/markdownPaths.test.ts',
  'src/schemas/catalogData.test.ts',
]

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: realCatalogTests,
          alias: { [resolve('src/data/repos.json')]: resolve('src/test/fixtures/repos.json') },
        },
      },
      {
        extends: true,
        test: { name: 'catalog-data', include: realCatalogTests },
      },
    ],
  },
})
