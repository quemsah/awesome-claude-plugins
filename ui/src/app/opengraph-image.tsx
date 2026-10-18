import { ImageResponse } from 'next/og'

export const alt = 'Awesome Claude Plugins'
export const contentType = 'image/png'
export const size = {
  width: 1_200,
  height: 630,
}

export default function OpenGraphImage() {
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
      <div style={{ color: '#ff8568', fontSize: 34, fontWeight: 600 }}>Awesome Claude Plugins</div>
      <div style={{ fontSize: 68, fontWeight: 700, marginTop: 26, textAlign: 'center' }}>Discover Claude Code plugins</div>
      <div style={{ color: '#d0d0d0', fontSize: 30, marginTop: 24, textAlign: 'center' }}>
        Search repositories, plugin adoption, and developer tools
      </div>
    </div>,
    size
  )
}
