import { ImageResponse } from 'next/og'
import { findCatalogRepo } from '../../../../lib/catalog.ts'

export const runtime = 'nodejs'

// Open Graph images use a limited built-in font. Emoji and dingbat symbols can trigger
// a runtime fallback-font fetch that returns HTTP 400 (observed for ✻).
// Preserve language text while dropping only these decorative glyphs from the preview.
export function sanitizeOgDescription(value: string): string {
  return value
    .replaceAll(/[\p{So}\p{Sk}]/gu, ' ')
    .replaceAll(/\uFE0e|\uFE0f|\u200d/gu, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

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
        {`${catalogRepo.owner}/${catalogRepo.repo_name}`}
      </div>
      <div style={{ color: '#d0d0d0', fontSize: 28, marginTop: 28, textAlign: 'center' }}>
        {sanitizeOgDescription(catalogRepo.description ?? 'Claude Code plugin repository').slice(0, 220) || 'Claude Code plugin repository'}
      </div>
    </div>,
    {
      height: 630,
      width: 1_200,
    }
  )
}
