import type { Metadata } from 'next'
import { BASE_URL } from './constants.ts'

type Alternates = NonNullable<Metadata['alternates']>

export function withSiteAlternates(alternates: Alternates): Alternates {
  return {
    ...alternates,
    types: {
      'application/feed+json': `${BASE_URL}/feed.json`,
      // Markdown alternates must point to an actual rendition of this route.
      ...alternates.types,
    },
  }
}
