import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { RepoCard } from '../../../components/search/RepoCard.tsx'
import { searchCatalogRepos } from '../../../lib/catalog.ts'
import { CATALOG_PAGE_SIZE } from '../../../lib/catalogPagination.ts'
import { BASE_URL } from '../../../lib/constants.ts'

const PAGE_NUMBER_PATTERN = /^[1-9]\d*$/
type BrowsePageProps = {
  params: Promise<{ page: string }>
}

export async function generateMetadata({ params }: BrowsePageProps): Promise<Metadata> {
  const page = parsePageNumber((await params).page)

  if (!page) {
    return {}
  }

  if (page === 1) {
    return {
      alternates: {
        canonical: `${BASE_URL}/`,
      },
    }
  }

  return {
    title: `Browse Claude Code Plugin Repositories - Page ${page}`,
    description: `Browse page ${page} of the Awesome Claude Plugins catalog.`,
    alternates: {
      canonical: `${BASE_URL}/browse/${page}`,
    },
  }
}

export default async function BrowsePage({ params }: BrowsePageProps) {
  const page = parsePageNumber((await params).page)
  if (!page) {
    notFound()
  }
  if (page === 1) {
    permanentRedirect('/')
  }

  const result = searchCatalogRepos('', 'stars-desc', page - 1, CATALOG_PAGE_SIZE)
  if (result.repos.length === 0) {
    notFound()
  }

  return (
    <main className="min-h-dvh bg-background" id="main-content" tabIndex={-1}>
      <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="mb-2 font-bold text-3xl">Browse Claude Code plugin repositories</h1>
        <p className="mb-6 text-muted-foreground">
          Page {page} of {Math.ceil(result.total / CATALOG_PAGE_SIZE)}
        </p>
        <ul className="m-0 grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {result.repos.map((repo) => (
            <li className="m-0 list-none p-0" key={repo.id}>
              <RepoCard repo={repo} />
            </li>
          ))}
        </ul>
        <nav aria-label="Catalog pagination" className="mt-8 flex items-center justify-between">
          {page > 1 ? (
            <Link className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={`/browse/${page - 1}`}>
              Previous page
            </Link>
          ) : (
            <span />
          )}
          {result.hasMore ? (
            <Link className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={`/browse/${page + 1}`}>
              Next page
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </main>
  )
}

function parsePageNumber(value: string): number | null {
  if (!PAGE_NUMBER_PATTERN.test(value)) {
    return null
  }

  return Number(value)
}
