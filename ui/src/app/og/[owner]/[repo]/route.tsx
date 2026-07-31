import { ImageResponse } from 'next/og'
import { findCatalogRepo } from '../../../../lib/catalog.ts'

export const contentType = 'image/png'
export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ owner: string; repo: string }>
}

export async function GET(_: Request, { params }: RouteContext) {
  const { owner, repo } = await params
  const catalogRepo = findCatalogRepo(`${owner}/${repo}`)

  if (!catalogRepo) {
    return new Response('Not found', { status: 404 })
  }

  return new ImageResponse(
    <div
      style={{
        alignItems: 'center',
        background: '#101010',
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        justifyContent: 'center',
        padding: 80,
        width: '100%',
      }}
    >
      <div style={{ color: '#b8b8b8', fontSize: 32 }}>Awesome Claude Plugins</div>
      <div style={{ fontSize: 64, fontWeight: 700, marginTop: 28, textAlign: 'center' }}>
        {catalogRepo.owner}/{catalogRepo.repo_name}
      </div>
      <div style={{ color: '#d0d0d0', fontSize: 28, marginTop: 28, textAlign: 'center' }}>
        {(catalogRepo.description ?? 'Claude Code plugin repository').slice(0, 220)}
      </div>
    </div>,
    {
      height: 630,
      width: 1_200,
    }
  )
}
