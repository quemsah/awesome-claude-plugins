import { Header } from '../components/common/Header.tsx'
import { SearchPage } from '../components/search/SearchPage.tsx'
import StructuredData from '../components/search/StructuredData.tsx'
import { TitleSection } from '../components/search/TitleSection.tsx'
import { parseSortOption, searchRepos } from '../lib/repoSearch.ts'

interface HomeProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams
  const query = getParam(params?.q)
  const sortOption = parseSortOption(getParam(params?.sort))
  const initialResult = searchRepos({ query, sortOption })

  return (
    <main className="min-h-screen bg-background">
      <StructuredData repos={initialResult.repos} />
      <Header />
      <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <TitleSection />
        <SearchPage initialResult={initialResult} />
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
