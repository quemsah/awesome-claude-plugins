import { Header } from '../components/common/Header.tsx'
import { SearchPage } from '../components/search/SearchPage.tsx'
import StructuredData from '../components/search/StructuredData.tsx'
import { TitleSection } from '../components/search/TitleSection.tsx'
import reposData from '../data/repos.json' with { type: 'json' }
import { type Repo, ReposArraySchema } from '../schemas/repo.schema.ts'

export default function Home() {
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
      <div className="container mx-auto px-4 py-8">
        <TitleSection />
        <SearchPage initialRepos={repos} />
      </div>
    </main>
  )
}
