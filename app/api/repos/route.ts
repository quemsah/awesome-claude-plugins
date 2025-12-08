import { NextResponse } from 'next/server'
import reposData from '../../../data/repos.json' with { type: 'json' }
import type { Repo } from '../../types/repo.type.ts'

export function GET() {
  const repos: Repo[] = reposData as Repo[]
  const validRepos = repos.filter((repo) => repo.repo_name !== null).sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))

  return NextResponse.json(validRepos)
}
