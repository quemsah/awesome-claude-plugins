import { defineConfig } from 'vitest/config'

const realCatalogTests = ['src/app/api/catalog/contract.test.ts', 'src/lib/markdownPaths.test.ts', 'src/schemas/catalogData.test.ts']

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: realCatalogTests,
          setupFiles: ['src/test/setupSmallCatalog.ts'],
        },
      },
      {
        extends: true,
        test: { name: 'catalog-data', include: realCatalogTests },
      },
    ],
  },
})
