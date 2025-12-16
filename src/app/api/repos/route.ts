import { NextResponse } from 'next/server'
import reposData from '../../../data/repos.json' with { type: 'json' }
import { createInternalServerErrorResponse, createValidationErrorResponse } from '../../../lib/api-response.ts'
import { type Repo, ReposArraySchema } from '../../../schemas/repo.schema.ts'

export function GET() {
  try {
    const validationResult = ReposArraySchema.safeParse(reposData)

    if (!validationResult.success) {
      return createValidationErrorResponse(
        validationResult.error,
        'Repos API - Data Validation',
        'Invalid repository data format',
        'The repository data failed validation'
      )
    }

    const repos: Repo[] = validationResult.data
    const validRepos = repos.filter((repo) => repo.repo_name !== null).sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))

    return NextResponse.json(validRepos)
  } catch (error) {
    return createInternalServerErrorResponse(
      error,
      'Repos API',
      'Internal server error',
      'An unexpected error occurred while processing repositories'
    )
  }
}
