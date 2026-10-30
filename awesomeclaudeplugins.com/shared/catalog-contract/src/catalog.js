import { z } from 'zod'
import { isGitHubSegment } from './identity.js'

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
const GitHubSegmentSchema = SafeTextSchema.refine(isGitHubSegment, 'must be a GitHub path segment')
const UtcTimestampSchema = z.string().refine(
  (value) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value,
  'must be a valid ISO UTC timestamp',
)

// Display records can include partial GitHub metadata. This is intentionally
// separate from the strict shape the crawler is allowed to publish.
export const PluginSummarySchema = z.object({
  description: z.string().optional(),
  name: z.string().optional(),
})

export const RepoSchema = z.object({
  stargazers_count: z.number().nullable(),
  forks_count: z.number().nullable(),
  subscribers_count: z.number().nullable(),
  description: z.string().nullable(),
  owner: GitHubSegmentSchema.nullable(),
  repo_name: GitHubSegmentSchema.nullable(),
  plugins_count: z.number().nullable(),
  plugins: z.array(PluginSummarySchema).optional(),
  plugin_name: z.string().optional(),
  plugin_description: z.string().optional(),
  plugin_summaries: z.array(PluginSummarySchema).optional(),
  catalog_updated_at: z.string().datetime().optional(),
  id: z.number(),
})

export const ReposArraySchema = z.array(RepoSchema)

// Published snapshot contract after #367 (derived URLs removed), #370
// (per-record lastmod required), and #352 (bounded optional summaries).
const PublishedPluginSummarySchema = z
  .object({
    name: SafeTextSchema.min(1).max(160).optional(),
    description: SafeTextSchema.min(1).max(300).optional(),
  })
  .strict()
  .refine((item) => item.name !== undefined || item.description !== undefined, 'invalid public plugin summary')

export const PublishedRepoSchema = z
  .object({
    stargazers_count: SafeCountSchema,
    forks_count: SafeCountSchema,
    subscribers_count: SafeCountSchema,
    description: SafeTextSchema.nullable(),
    owner: GitHubSegmentSchema,
    repo_name: GitHubSegmentSchema,
    plugins_count: SafeCountSchema.nullable(),
    plugins: z.array(PublishedPluginSummarySchema).max(30).optional(),
    catalog_updated_at: UtcTimestampSchema,
    id: z.number().int().refine(Number.isSafeInteger).positive(),
  })
  .strict()

export const PublishedReposArraySchema = z.array(PublishedRepoSchema)
