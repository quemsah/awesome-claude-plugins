import { z } from 'zod'
import { getGitHubOwnerUrl, getGitHubRepoUrl, isGitHubSegment } from './identity.js'

function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) index += 1
      else return false
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}

const SafeTextSchema = z.string().refine(isWellFormedUnicode, 'invalid UTF-8 (unpaired surrogate)')
const SafeCountSchema = z.number().int().refine(Number.isSafeInteger).nonnegative()
const CanonicalRepoUrlShape = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const CanonicalOwnerUrlShape = /^https:\/\/github\.com\/[A-Za-z0-9._-]+$/

export const RepoSchema = z
  .object({
    html_url: SafeTextSchema.refine((value) => CanonicalRepoUrlShape.test(value), 'must be the canonical GitHub repository URL'),
    stargazers_count: SafeCountSchema,
    forks_count: SafeCountSchema,
    subscribers_count: SafeCountSchema,
    description: SafeTextSchema.nullable(),
    owner: SafeTextSchema.refine(isGitHubSegment, 'must be a GitHub owner segment'),
    owner_url: SafeTextSchema.refine((value) => CanonicalOwnerUrlShape.test(value), 'must be the canonical GitHub owner URL'),
    repo_name: SafeTextSchema.refine(isGitHubSegment, 'must be a GitHub repository segment'),
    plugins_count: SafeCountSchema.nullable(),
    id: z.number().int().refine(Number.isSafeInteger).positive(),
  })
  .strict()
  .superRefine((repo, context) => {
    if (repo.html_url !== getGitHubRepoUrl(repo.owner, repo.repo_name)) {
      context.addIssue({
        code: 'custom',
        message: 'must be the canonical GitHub repository URL',
        path: ['html_url'],
      })
    }
    if (repo.owner_url !== getGitHubOwnerUrl(repo.owner)) {
      context.addIssue({
        code: 'custom',
        message: 'must be the canonical GitHub owner URL',
        path: ['owner_url'],
      })
    }
  })

export const ReposArraySchema = z.array(RepoSchema)
