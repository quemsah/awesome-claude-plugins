import type { z } from 'zod'

export function trackValidationError(error: z.ZodError, context: string): void {
  console.error(`[Validation] ${context}:`, error.message)
  error.issues.forEach((issue) => {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
  })
}
