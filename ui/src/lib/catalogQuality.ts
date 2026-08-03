import type { Repo } from '../schemas/repo.schema.ts'

export type CatalogPublicationState = 'indexable' | 'needs-review' | 'redirect'
export type CatalogDescriptionQuality = 'strong' | 'weak' | 'missing'

export type CatalogQuality = {
  descriptionQuality: CatalogDescriptionQuality
  publicationState: CatalogPublicationState
  qualityReason: string
}

export function getCatalogQuality(repo: Repo, isCanonical: boolean): CatalogQuality {
  if (!isCanonical) {
    return {
      descriptionQuality: getDescriptionQuality(repo),
      publicationState: 'redirect',
      qualityReason: 'Duplicate case-insensitive repository path; the canonical record is published.',
    }
  }

  if (!repo.description?.trim()) {
    return {
      descriptionQuality: 'missing',
      publicationState: 'needs-review',
      qualityReason: 'Repository description is missing.',
    }
  }

  if (repo.plugins_count === null) {
    return {
      descriptionQuality: getDescriptionQuality(repo),
      publicationState: 'needs-review',
      qualityReason: 'Validated marketplace plugin count is unavailable.',
    }
  }

  return {
    descriptionQuality: getDescriptionQuality(repo),
    publicationState: 'indexable',
    qualityReason: 'Canonical repository has a description and validated plugin count.',
  }
}

function getDescriptionQuality(repo: Repo): CatalogDescriptionQuality {
  const descriptionLength = repo.description?.trim().length ?? 0
  if (descriptionLength === 0) {
    return 'missing'
  }
  return descriptionLength >= 40 ? 'strong' : 'weak'
}
