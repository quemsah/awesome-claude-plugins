/** biome-ignore-all lint/style/useNamingConvention: GitHub API fields use snake_case. */
import { z } from 'zod'
import { isGitHubSegment } from '../lib/repositoryIdentity.ts'

function isValidHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isValidGitHubUrl(value: unknown): boolean {
  if (!isValidHttpUrl(value)) return false
  try {
    const url = new URL(value as string)
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password
  } catch {
    return false
  }
}

const HttpUrlSchema = z.string().refine(isValidHttpUrl, 'URL must use HTTP or HTTPS')

const GitHubUrlSchema = z.string().refine(isValidGitHubUrl, 'Must be a secure GitHub URL')

const GitHubSegmentSchema = z.string().min(1).max(100).refine(isGitHubSegment, 'Must be a valid GitHub path segment')

const GitHubOwnerSchema = z.object({
  avatar_url: HttpUrlSchema,
  html_url: GitHubUrlSchema,
  login: GitHubSegmentSchema,
  type: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'Must be a valid GitHub owner type'),
})

const GitHubLicenseSchema = z.object({
  name: z.string().min(1).max(160),
  url: HttpUrlSchema.nullable().optional(),
})

export const GitHubRepositorySchema = z
  .object({
    created_at: z.string().datetime({ offset: true }).nullable().optional().default(null),
    default_branch: z.string().min(1).max(255),
    description: z.string().max(10_000).nullable().optional().default(null),
    forks_count: z.number().int().nonnegative().nullable().optional().default(0),
    html_url: GitHubUrlSchema,
    homepage: HttpUrlSchema.nullable().optional().default(null),
    language: z.string().max(100).nullable().optional().default(null),
    license: GitHubLicenseSchema.nullable().optional().default(null),
    name: GitHubSegmentSchema,
    open_issues_count: z.number().int().nonnegative().nullable().optional().default(0),
    owner: GitHubOwnerSchema,
    pushed_at: z.string().datetime({ offset: true }).nullable().optional().default(null),
    size: z.number().int().nonnegative().nullable().optional().default(null),
    stargazers_count: z.number().int().nonnegative().nullable().optional().default(0),
    subscribers_count: z.number().int().nonnegative().nullable().optional().default(0),
    topics: z.array(z.string().min(1).max(100)).max(100).optional().default([]),
    updated_at: z.string().datetime({ offset: true }).nullable().optional().default(null),
  })
  .superRefine((repository, context) => {
    let repositoryPath: string[] = []
    try {
      repositoryPath = new URL(repository.html_url).pathname.split('/').filter(Boolean)
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Repository URL is malformed',
        path: ['html_url'],
      })
      return
    }

    if (
      repositoryPath.length !== 2 ||
      repositoryPath[0].toLowerCase() !== repository.owner.login.toLowerCase() ||
      repositoryPath[1].toLowerCase() !== repository.name.toLowerCase()
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Repository URL must match the owner and repository name',
        path: ['html_url'],
      })
    }

    let ownerPath: string[] = []
    try {
      ownerPath = new URL(repository.owner.html_url).pathname.split('/').filter(Boolean)
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Owner URL is malformed',
        path: ['owner', 'html_url'],
      })
      return
    }

    if (ownerPath.length !== 1 || ownerPath[0].toLowerCase() !== repository.owner.login.toLowerCase()) {
      context.addIssue({
        code: 'custom',
        message: 'Owner URL must match the owner login',
        path: ['owner', 'html_url'],
      })
    }
  })

export type GitHubRepository = z.infer<typeof GitHubRepositorySchema>

