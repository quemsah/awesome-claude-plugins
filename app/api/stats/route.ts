import { NextResponse } from 'next/server'
import statsData from '../../../data/stats.json' with { type: 'json' }

export function GET() {
  return NextResponse.json(statsData)
}
