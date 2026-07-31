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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
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
            value: `default-src 'self'; script-src ${scriptSource}; img-src 'self' data: https://queue.simpleanalyticscdn.com https://avatars.githubusercontent.com; connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://queue.simpleanalyticscdn.com https://scripts.simpleanalyticscdn.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ]
  },
  // Code splitting and tree-shaking optimizations
  productionBrowserSourceMaps: false,
}

export default bundleAnalyzer(nextConfig)
