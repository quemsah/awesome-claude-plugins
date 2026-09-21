import process from 'node:process'
import withBundleAnalyzer from '@next/bundle-analyzer'
import type { NextConfig } from 'next'

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
})

const scriptSource = [
  "'self'",
  "'unsafe-inline'",
  ...(process.env.NODE_ENV === 'development' ? ["'unsafe-eval'"] : []),
  'https://scripts.simpleanalyticscdn.com',
].join(' ')

const GITHUB_RAW_URL = process.env.GITHUB_RAW_URL ?? 'https://raw.githubusercontent.com'
const GITHUB_API_URL = process.env.GITHUB_API_URL ?? 'https://api.github.com'
const release = process.env.NEXT_PUBLIC_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? ''

function extractConnectOrigin(url: string, fallback: string): string {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return fallback
    }
    return parsed.origin
  } catch {
    return fallback
  }
}

const rawOrigin = extractConnectOrigin(GITHUB_RAW_URL, 'https://raw.githubusercontent.com')
// The browser reads both origins from runtime props, so an override has to move the policy with it.
const apiOrigin = extractConnectOrigin(GITHUB_API_URL, 'https://api.github.com')

const mockGithubUrl = `http://127.0.0.1:${process.env.MOCK_GITHUB_PORT ?? '3100'}`

const connectSource = [
  "'self'",
  apiOrigin,
  rawOrigin,
  'https://queue.simpleanalyticscdn.com',
  'https://scripts.simpleanalyticscdn.com',
  // Frozen at build time while the browser gets the mock origin from the runtime `rawBaseUrl` prop.
  ...(process.env.PLAYWRIGHT_BASE_URL ? [mockGithubUrl] : []),
].join(' ')

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    // biome-ignore lint/style/useNamingConvention: Next.js env keys must match the public environment variable name.
    NEXT_PUBLIC_RELEASE: release,
  },
  // Dev-only: `next dev` allow-lists the `localhost` hostname but not the `127.0.0.1` IP literal.
  allowedDevOrigins: ['127.0.0.1'],
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn', 'info'] } : false,
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'avatars.githubusercontent.com' }],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
          { key: 'TDM-Reservation', value: '0' },
          { key: 'No-Vary-Search', value: 'params=("utm_source" "utm_medium" "utm_campaign" "utm_term" "utm_content"), key-order' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=()' },
          { key: 'Reporting-Endpoints', value: 'csp="/api/reports"' },
          {
            key: 'Content-Security-Policy-Report-Only',
            value: "require-trusted-types-for 'script'; trusted-types nextjs; report-to csp",
          },
          {
            key: 'Link',
            value:
              '</llms.txt>; rel="describedby"; type="text/plain", </sitemap.xml>; rel="sitemap"; type="application/xml", </.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
          },
          {
            key: 'Content-Security-Policy',
            // `script-src` still needs 'unsafe-inline' because Next.js streams the RSC payload
            // through inline scripts; switching to a nonce would opt every page out of static
            // rendering. The JSON-LD payloads that could be injected are escaped in `serializeJsonLd`.
            value: `default-src 'self'; script-src ${scriptSource}; img-src 'self' data: https://queue.simpleanalyticscdn.com https://avatars.githubusercontent.com; connect-src ${connectSource}; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ]
  },
  // Code splitting and tree-shaking optimizations
  productionBrowserSourceMaps: false,
}

export default bundleAnalyzer(nextConfig)
