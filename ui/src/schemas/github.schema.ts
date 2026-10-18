/** biome-ignore-all lint/style/useNamingConvention: GitHub API fields use snake_case. */
import * as z from 'zod/mini'
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

const HttpUrlSchema = z.string().check(z.refine(isValidHttpUrl, { error: 'URL must use HTTP or HTTPS' }))

const GitHubUrlSchema = z.string().check(z.refine(isValidGitHubUrl, { error: 'Must be a secure GitHub URL' }))

const GitHubSegmentSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(100), z.refine(isGitHubSegment, { error: 'Must be a valid GitHub path segment' }))

const GitHubOwnerSchema = z.object({
  avatar_url: z._default(z.optional(z.nullable(HttpUrlSchema)), null),
  html_url: GitHubUrlSchema,
  login: GitHubSegmentSchema,
  type: z._default(
    z.optional(z.nullable(z.string().check(z.regex(/^[A-Za-z][A-Za-z0-9_-]*$/, { error: 'Must be a valid GitHub owner type' })))),
    null
  ),
})

const GitHubLicenseSchema = z.object({
  name: z.string().check(z.minLength(1), z.maxLength(160)),
  url: z.optional(z.nullable(HttpUrlSchema)),
})

/** GitHub sends an empty string for a repository without a homepage, which is absent rather than malformed. */
const HomepageUrlSchema = z.pipe(
  z.transform((value: unknown) => (value === '' ? null : (value as string | null | undefined))),
  z._default(z.optional(z.nullable(HttpUrlSchema)), null)
)

export const GitHubRepositorySchema = z
  .object({
    created_at: z._default(z.optional(z.nullable(z.iso.datetime({ offset: true }))), null),
    default_branch: z.string().check(z.minLength(1), z.maxLength(255)),
    description: z._default(z.optional(z.nullable(z.string().check(z.maxLength(10_000)))), null),
    forks_count: z._default(z.optional(z.nullable(z.int().check(z.nonnegative()))), 0),
    html_url: GitHubUrlSchema,
    homepage: HomepageUrlSchema,
    language: z._default(z.optional(z.nullable(z.string().check(z.maxLength(100)))), null),
    license: z._default(z.optional(z.nullable(GitHubLicenseSchema)), null),
    name: GitHubSegmentSchema,
    // The catalog never records issue counts and GitHub may omit the field, so 0 would read as a confirmed count.
    open_issues_count: z._default(z.optional(z.nullable(z.int().check(z.nonnegative()))), null),
    owner: GitHubOwnerSchema,
    pushed_at: z._default(z.optional(z.nullable(z.iso.datetime({ offset: true }))), null),
    size: z._default(z.optional(z.nullable(z.int().check(z.nonnegative()))), null),
    stargazers_count: z._default(z.optional(z.nullable(z.int().check(z.nonnegative()))), 0),
    subscribers_count: z._default(z.optional(z.nullable(z.int().check(z.nonnegative()))), 0),
    topics: z._default(z.optional(z.array(z.string().check(z.minLength(1), z.maxLength(100))).check(z.maxLength(100))), []),
    updated_at: z._default(z.optional(z.nullable(z.iso.datetime({ offset: true }))), null),
  })
  .check((context) => {
    const repository = context.value
    let repositoryPath: string[] = []
    try {
      repositoryPath = new URL(repository.html_url).pathname.split('/').filter(Boolean)
    } catch {
      context.issues.push({
        code: 'custom',
        message: 'Repository URL is malformed',
        path: ['html_url'],
        input: repository,
      })
      return
    }

    if (
      repositoryPath.length !== 2 ||
      repositoryPath[0].toLowerCase() !== repository.owner.login.toLowerCase() ||
      repositoryPath[1].toLowerCase() !== repository.name.toLowerCase()
    ) {
      context.issues.push({
        code: 'custom',
        message: 'Repository URL must match the owner and repository name',
        path: ['html_url'],
        input: repository,
      })
    }

    let ownerPath: string[] = []
    try {
      ownerPath = new URL(repository.owner.html_url).pathname.split('/').filter(Boolean)
    } catch {
      context.issues.push({
        code: 'custom',
        message: 'Owner URL is malformed',
        path: ['owner', 'html_url'],
        input: repository,
      })
      return
    }

    if (ownerPath.length !== 1 || ownerPath[0].toLowerCase() !== repository.owner.login.toLowerCase()) {
      context.issues.push({
        code: 'custom',
        message: 'Owner URL must match the owner login',
        path: ['owner', 'html_url'],
        input: repository,
      })
    }
  })

export type GitHubRepository = z.infer<typeof GitHubRepositorySchema>
