import { NextResponse } from 'next/server'
import statsData from '../../../data/stats.json' with { type: 'json' }
import { createInternalServerErrorResponse, createValidationErrorResponse } from '../../../lib/api-response.ts'
import { StatsArraySchema } from '../../../schemas/stats.schema.ts'

export function GET() {
  try {
    const validationResult = StatsArraySchema.safeParse(statsData)

    if (!validationResult.success) {
      return createValidationErrorResponse(
        validationResult.error,
        'Stats API - Data Validation',
        'Invalid statistics data format',
        'The statistics data failed validation'
      )
    }

    return NextResponse.json(validationResult.data)
  } catch (error) {
    return createInternalServerErrorResponse(
      error,
      'Stats API',
      'Internal server error',
      'An unexpected error occurred while processing statistics'
    )
  }
}
