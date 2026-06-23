/** biome-ignore-all lint/style/useNamingConvention: lifecycle catalog metadata uses snake_case field names */
import lifecycleData from '../data/repo-lifecycle.json' with { type: 'json' }
import type { Repo } from '../schemas/repo.schema.ts'

export const lifecycleStatuses = ['active', 'archived', 'deleted', 'fork', 'mirror', 'renamed', 'stale', 'case_collision'] as const

export type RepoLifecycleStatus = (typeof lifecycleStatuses)[number]

interface LifecycleRecord {
  slug: string
  status: RepoLifecycleStatus
  canonical_slug?: string
  reason?: string
}

export interface RepoLifecycle {
  status: RepoLifecycleStatus
  label: string
  description: string
  canonicalSlug: string | null
}

const lifecycleRecords = lifecycleData.repositories as LifecycleRecord[]
const lifecycleByExactSlug = new Map(lifecycleRecords.map((record) => [record.slug, record]))

const lifecycleRank: Record<RepoLifecycleStatus, number> = {
  active: 0,
  archived: 1,
  fork: 2,
  case_collision: 3,
  stale: 4,
  mirror: 5,
  renamed: 6,
  deleted: 7,
}

const lifecycleCopy: Record<RepoLifecycleStatus, Omit<RepoLifecycle, 'status' | 'canonicalSlug'>> = {
  active: {
    label: 'Active',
    description: 'Repository is treated as the canonical active catalog entry.',
  },
  archived: {
    label: 'Archived',
    description: 'Repository is archived upstream and may not receive maintenance.',
  },
  deleted: {
    label: 'Deleted',
    description: 'Repository is no longer available and should not be promoted.',
  },
  fork: {
    label: 'Fork',
    description: 'Repository is marked as a fork and is ranked behind canonical sources.',
  },
  mirror: {
    label: 'Mirror',
    description: 'Repository is marked as a mirror and is not treated as the primary source.',
  },
  renamed: {
    label: 'Renamed',
    description: 'Repository has a known canonical replacement slug.',
  },
  stale: {
    label: 'Stale',
    description: 'Repository has not been observed in a recent successful catalog check.',
  },
  case_collision: {
    label: 'Case duplicate',
    description: 'Repository slug collides with another entry when owner and repo casing are ignored.',
  },
}

export function getRepoSlug(repo: Pick<Repo, 'owner' | 'repo_name'>): string | null {
  if (!(repo.owner && repo.repo_name)) {
    return null
  }
  return `${repo.owner}/${repo.repo_name}`
}

export function getRepoLifecycle(repo: Repo): RepoLifecycle {
  const slug = getRepoSlug(repo)
  const record = slug ? lifecycleByExactSlug.get(slug) : undefined
  const status = getDeclaredStatus(repo, record)
  const canonicalSlug = repo.canonical_slug ?? record?.canonical_slug ?? slug

  return {
    status,
    canonicalSlug,
    ...lifecycleCopy[status],
  }
}

export function compareRepoLifecycleRank(a: Repo, b: Repo): number {
  return lifecycleRank[getRepoLifecycle(a).status] - lifecycleRank[getRepoLifecycle(b).status]
}

export function shouldIncludeRepoInSitemap(repo: Repo): boolean {
  return !['deleted', 'renamed', 'mirror'].includes(getRepoLifecycle(repo).status)
}

export function getRepoSitemapPriority(repo: Repo): number {
  switch (getRepoLifecycle(repo).status) {
    case 'active':
      return 0.5
    case 'archived':
    case 'stale':
      return 0.2
    case 'fork':
    case 'case_collision':
      return 0.3
    default:
      return 0.1
  }
}

function getDeclaredStatus(repo: Repo, record: LifecycleRecord | undefined): RepoLifecycleStatus {
  if (repo.deleted) {
    return 'deleted'
  }
  if (repo.archived) {
    return 'archived'
  }
  if (repo.fork) {
    return 'fork'
  }
  if (repo.mirror_url) {
    return 'mirror'
  }
  return repo.lifecycle_status ?? record?.status ?? 'active'
}
