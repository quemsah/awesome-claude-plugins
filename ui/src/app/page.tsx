import { Header } from '../components/common/Header.tsx'
import { SearchPage } from '../components/search/SearchPage.tsx'
import StructuredData from '../components/search/StructuredData.tsx'
import { TitleSection } from '../components/search/TitleSection.tsx'
import reposData from '../data/repos.json' with { type: 'json' }
import { parseSortOption } from '../lib/searchState.mjs'
import type { Repo } from '../schemas/repo.schema.ts'
import { ReposArraySchema } from '../schemas/repo.schema.ts'

interface HomeProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams
  const initialSearchTerm = getParam(params?.q)
  const initialSortOption = parseSortOption(getParam(params?.sort))
  let repos: Repo[] = []

  try {
    const validationResult = ReposArraySchema.safeParse(reposData)
    if (validationResult.success) {
      repos = validationResult.data.filter((repo) => repo.repo_name !== null)
    }
  } catch (error) {
    console.error('Failed to load repositories:', error)
  }

  return (
    <main className="min-h-screen bg-background">
      <StructuredData repos={repos} />
      <Header />
      <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <TitleSection />
        <SearchPage initialRepos={repos} initialSearchTerm={initialSearchTerm} initialSortOption={initialSortOption} />
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
