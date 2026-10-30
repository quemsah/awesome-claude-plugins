import { BASE_URL } from '../../../../lib/constants.ts'

export const dynamic = 'force-static'

export function GET() {
  return Response.json(
    {
      version: '1.0',
      skills: [
        {
          name: 'awesome-claude-plugins-catalog',
          description: 'Discover Claude Code plugin repositories and retrieve their marketplace install commands.',
          url: `${BASE_URL}/SKILL.md`,
        },
      ],
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600',
      },
    }
  )
}
