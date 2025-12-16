import { NextResponse } from 'next/server'
import statsData from '../../../data/stats.json' with { type: 'json' }
import { trackValidationError } from '../../../lib/validation.ts'
import { StatsArraySchema } from '../../../schemas/stats.schema.ts'

export function GET() {
  try {
    const validationResult = StatsArraySchema.safeParse(statsData)

    if (!validationResult.success) {
      trackValidationError(validationResult.error, 'Stats API - Data Validation')

      const errorDetails = validationResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
        ...('received' in issue ? { received: issue.received } : {}),
        ...('expected' in issue ? { expected: issue.expected } : {}),
      }))

      return new NextResponse(
        JSON.stringify({
          error: 'Invalid statistics data format',
          message: 'The statistics data failed validation',
          details: errorDetails,
          validationIssues: validationResult.error.issues.length,
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return NextResponse.json(validationResult.data)
  } catch (error) {
    console.error('Unexpected error in stats API:', error)

    return new NextResponse(
      JSON.stringify({
        error: 'Internal server error',
        message: 'An unexpected error occurred while processing statistics',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
