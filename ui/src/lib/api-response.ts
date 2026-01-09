import { NextResponse } from 'next/server'
import type { ZodError } from 'zod'
import { trackValidationError } from './validation.ts'

export function createValidationErrorResponse(error: ZodError, context: string, errorTitle: string, message: string) {
  trackValidationError(error, context)

  const errorDetails = error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
    ...('received' in issue ? { received: (issue as unknown as Record<string, unknown>).received } : {}),
    ...('expected' in issue ? { expected: (issue as unknown as Record<string, unknown>).expected } : {}),
  }))

  return new NextResponse(
    JSON.stringify({
      error: errorTitle,
      message: message,
      details: errorDetails,
      validationIssues: error.issues.length,
    }),
    { status: 422, headers: { 'Content-Type': 'application/json' } }
  )
}

export function createInternalServerErrorResponse(
  error: unknown,
  context: string,
  errorTitle = 'Internal server error',
  message = 'An unexpected error occurred'
) {
  console.error(`Unexpected error in ${context}:`, error)

  return new NextResponse(
    JSON.stringify({
      error: errorTitle,
      message: message,
    }),
    { status: 500, headers: { 'Content-Type': 'application/json' } }
  )
}
