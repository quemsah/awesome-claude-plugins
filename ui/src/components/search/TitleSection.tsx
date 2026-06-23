import catalogMetaData from '../../data/catalog-meta.json' with { type: 'json' }
import { formatDate } from '../../lib/utils.ts'
import { CatalogMetaSchema } from '../../schemas/catalog-meta.schema.ts'

export function TitleSection() {
  let lastUpdated: string | null = null

  const validationResult = CatalogMetaSchema.safeParse(catalogMetaData)

  if (validationResult.success) {
    const date = new Date(validationResult.data.generated_at)
    lastUpdated = formatDate(date)
  }

  return (
    <div className="mb-8 space-y-3 text-center">
      <h1 className="mb-2 font-bold text-2xl sm:text-3xl lg:text-4xl">Awesome Claude Plugins</h1>
      <p className="mx-auto max-w-2xl text-muted-foreground text-sm sm:text-base">
        Automated collection of Claude Code plugin adoption metrics across GitHub repositories using n8n workflows
        {lastUpdated ? `. Last updated: ${lastUpdated}` : ''}
      </p>
    </div>
  )
}
