import type { Repo } from '../schemas/repo.schema.ts'

export type RepoVerificationStatus = 'verified' | 'discovered' | 'unavailable' | 'stale' | 'invalid'

type RepoVerification = {
  status: RepoVerificationStatus
  label: string
  description: string
}

const verificationLabels: Record<RepoVerificationStatus, Omit<RepoVerification, 'status'>> = {
  verified: {
    label: 'Verified',
    description: 'This repository has a positive plugin count in the catalog snapshot.',
  },
  discovered: {
    label: 'Discovered',
    description: 'This repository matched discovery signals but has not been verified with installable marketplace data.',
  },
  unavailable: {
    label: 'Unavailable',
    description: 'The marketplace manifest was not available during the latest verification.',
  },
  stale: {
    label: 'Stale',
    description: 'This repository needs a fresh verification check.',
  },
  invalid: {
    label: 'Invalid',
    description: 'This repository has invalid marketplace data.',
  },
}

export function getRepoVerification(repo: Repo): RepoVerification {
  const status = repo.verification_status ?? deriveVerificationStatus(repo)
  return {
    status,
    ...verificationLabels[status],
  }
}

export function isVerifiedRepo(repo: Repo): boolean {
  return getRepoVerification(repo).status === 'verified'
}

function deriveVerificationStatus(repo: Repo): RepoVerificationStatus {
  if (repo.marketplace_status === 'not_found' || repo.marketplace_status === 'unavailable') {
    return 'unavailable'
  }

  if (repo.marketplace_status === 'invalid') {
    return 'invalid'
  }

  if (repo.marketplace_status === 'stale') {
    return 'stale'
  }

  return (repo.plugins_count ?? 0) > 0 ? 'verified' : 'discovered'
}
