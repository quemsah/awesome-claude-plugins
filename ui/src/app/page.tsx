import type { Metadata } from 'next'
import { SearchPage } from '../components/search/SearchPage.tsx'
import StructuredData from '../components/search/StructuredData.tsx'
import { TitleSection } from '../components/search/TitleSection.tsx'
import { searchCatalogRepos } from '../lib/catalog.ts'
import { CATALOG_PAGE_SIZE } from '../lib/catalogPagination.ts'
import { BASE_URL } from '../lib/constants.ts'
import { parseSortOption } from '../lib/searchState.ts'

interface HomeProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export const metadata: Metadata = {
  alternates: {
    canonical: `${BASE_URL}/`,
  },
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams
  const initialSearchTerm = getParam(params?.q)
  const initialSortOption = parseSortOption(getParam(params?.sort))
  const searchResult = searchCatalogRepos(initialSearchTerm, initialSortOption, 0, CATALOG_PAGE_SIZE)

  return (
    <main className="min-h-dvh bg-background" id="main-content" tabIndex={-1}>
      <StructuredData repos={searchResult.repos} />
      <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <TitleSection />
        <SearchPage
          initialPluginCount={searchResult.pluginsCount}
          initialRepos={searchResult.repos}
          initialSearchTerm={initialSearchTerm}
          initialSortOption={initialSortOption}
          initialTotal={searchResult.total}
        />
      </div>
    </main>
  )
}

function getParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? ''
  }
  return value ?? ''
}
