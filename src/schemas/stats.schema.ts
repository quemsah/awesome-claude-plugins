import { z } from 'zod'

export const StatsItemSchema = z.object({
  date: z.string().datetime(),
  size: z.string(),
  id: z.number(),
})

export const StatsArraySchema = z.array(StatsItemSchema)

export type StatsItem = z.infer<typeof StatsItemSchema>
