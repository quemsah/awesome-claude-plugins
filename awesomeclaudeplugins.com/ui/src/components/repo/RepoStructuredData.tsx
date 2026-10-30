/** biome-ignore-all lint/security/noDangerouslySetInnerHtml: <Used to inject ld+json> */
import { serializeJsonLd } from '../../lib/jsonLd.ts'
import { getRepoStructuredData } from '../../lib/repoStructuredData.ts'
import type { GitHubRepository } from '../../schemas/github.schema.ts'

interface RepoStructuredDataProps {
  repo: GitHubRepository
}

export default function RepoStructuredData({ repo }: RepoStructuredDataProps) {
  return (
    <>
      {getRepoStructuredData(repo).map((node) => (
        <script dangerouslySetInnerHTML={{ __html: serializeJsonLd(node) }} key={String(node['@type'])} type="application/ld+json" />
      ))}
    </>
  )
}
