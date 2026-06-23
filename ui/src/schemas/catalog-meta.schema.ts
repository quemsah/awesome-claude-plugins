/** biome-ignore-all lint/style/useNamingConvention: Catalog metadata is generated as snake_case JSON. */
import { z } from 'zod'

export const CatalogMetaSchema = z.object({
  generated_at: z.string().datetime(),
  source_version: z.string().min(1),
  discovery_query_version: z.string().min(1),
  repository_count: z.number().int().nonnegative(),
  plugin_count: z.number().int().nonnegative(),
  validation_status: z.enum(['not_run', 'passed', 'passed_with_known_anomalies', 'failed']),
  validation_summary: z.object({
    checked_at: z.string().datetime(),
    repository_count_matches_latest_stats: z.boolean(),
    known_anomalies: z.array(
      z.object({
        name: z.string().min(1),
        count: z.number().int().nonnegative(),
        reason: z.string().min(1),
      })
    ),
  }),
})

export type CatalogMeta = z.infer<typeof CatalogMetaSchema>
