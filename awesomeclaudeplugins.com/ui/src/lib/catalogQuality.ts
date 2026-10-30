import type { Repo } from '../schemas/repo.schema.ts'

export type CatalogPublicationState = 'indexable' | 'needs-review' | 'redirect'
export type CatalogDescriptionQuality = 'strong' | 'weak' | 'missing'

export type CatalogQuality = {
  descriptionQuality: CatalogDescriptionQuality
  publicationState: CatalogPublicationState
  qualityReason: string
}

export function getCatalogQuality(repo: Repo, isCanonical: boolean, fallbackDescription?: string | null): CatalogQuality {
  if (!isCanonical) {
    return {
      descriptionQuality: getDescriptionQuality(repo, fallbackDescription),
      publicationState: 'redirect',
      qualityReason: 'Duplicate case-insensitive repository path; the canonical record is published.',
    }
  }

  const descriptionQuality = getDescriptionQuality(repo, fallbackDescription)
  // Publication is derived only from the checked-in catalog snapshot. A live manifest
  // fetch may improve metadata but must never make robots disagree with the sitemap.
  if (repo.plugins_count === null) {
    return {
      descriptionQuality,
      publicationState: 'needs-review',
      qualityReason: 'Validated marketplace plugin count is unavailable.',
    }
  }

  return {
    descriptionQuality,
    publicationState: 'indexable',
    qualityReason: 'Canonical repository has a validated plugin count.',
  }
}

export function getDescriptionQuality(repo: Repo, fallbackDescription?: string | null): CatalogDescriptionQuality {
  const repoDescription = repo.description?.trim()
  if (repoDescription) {
    return repoDescription.length >= 40 ? 'strong' : 'weak'
  }

  const fallback = fallbackDescription?.trim()
  if (fallback) {
    return fallback.length >= 40 ? 'strong' : 'weak'
  }

  return 'missing'
}
