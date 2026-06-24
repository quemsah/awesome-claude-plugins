import { z } from 'zod'

export const StatsItemSchema = z.object({
  date: z.string().datetime().describe('Exact UTC timestamp when the catalog repository count was observed.'),
  size: z.number().int().nonnegative().describe('Repository count observed at the timestamp.'),
})

export const StatsArraySchema = z.array(StatsItemSchema)

export type StatsItem = z.infer<typeof StatsItemSchema>
