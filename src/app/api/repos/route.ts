import { NextResponse } from 'next/server'
import reposData from '../../../data/repos.json' with { type: 'json' }
import { trackValidationError } from '../../../lib/validation.ts'
import { type Repo, ReposArraySchema } from '../../../schemas/repo.schema.ts'

export function GET() {
  try {
    const validationResult = ReposArraySchema.safeParse(reposData)

    if (!validationResult.success) {
      trackValidationError(validationResult.error, 'Repos API - Data Validation')

      const errorDetails = validationResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
        ...('received' in issue ? { received: issue.received } : {}),
        ...('expected' in issue ? { expected: issue.expected } : {}),
      }))

      return new NextResponse(
        JSON.stringify({
          error: 'Invalid repository data format',
          message: 'The repository data failed validation',
          details: errorDetails,
          validationIssues: validationResult.error.issues.length,
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const repos: Repo[] = validationResult.data
    const validRepos = repos.filter((repo) => repo.repo_name !== null).sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))

    return NextResponse.json(validRepos)
  } catch (error) {
    console.error('Unexpected error in repos API:', error)

    return new NextResponse(
      JSON.stringify({
        error: 'Internal server error',
        message: 'An unexpected error occurred while processing repositories'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
