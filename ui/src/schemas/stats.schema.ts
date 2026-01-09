import { z } from 'zod'

export const StatsItemSchema = z.object({
  date: z.string().datetime(),
  size: z.string(),
})

export const StatsArraySchema = z.array(StatsItemSchema)

export type StatsItem = z.infer<typeof StatsItemSchema>
