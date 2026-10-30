import Link from 'next/link'
import { getCatalogLastModified } from '../../lib/catalog.ts'
import { formatDate } from '../../lib/utils.ts'

export function TitleSection() {
  const lastUpdated = formatDate(getCatalogLastModified())

  return (
    <div className="mb-4 space-y-4 text-center">
      <h1 className="mb-2 text-2xl font-bold text-balance sm:text-3xl lg:text-4xl">Awesome Claude Plugins</h1>
      <div className="text-muted-foreground mx-auto max-w-3xl space-y-2 text-xs sm:text-sm">
        <p>
          Catalog snapshot: {lastUpdated}.{' '}
          <Link className="hover:text-foreground underline-offset-4 hover:underline" href="/about">
            Read the methodology and correction policy.
          </Link>
        </p>
      </div>
    </div>
  )
}
