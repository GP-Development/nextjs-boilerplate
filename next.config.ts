import { randomUUID } from 'node:crypto'
import type { NextConfig } from 'next'
import { API_CSP, BASE_SECURITY_HEADERS, FALLBACK_CSP } from './src/lib/security-headers'

// BUILD_OUTPUT selects the packaging mode at build time:
//   standalone -> minimal self-contained server for Docker/VPS (test 22)
//   export     -> fully static files, no server (test 23)
//   (unset)    -> normal `next start` server, used by most managed hosts
const output = process.env.BUILD_OUTPUT
if (output !== undefined && output !== '' && output !== 'standalone' && output !== 'export') {
  throw new Error('BUILD_OUTPUT must be "standalone", "export" or unset')
}

// One id per build, inlined as COMPAT_BUILD_ID and used as Next's build id (test 21).
const buildId = (process.env.GITHUB_SHA ?? randomUUID()).slice(0, 12)

const nextConfig: NextConfig = {
  generateBuildId: async () => buildId,
  env: { COMPAT_BUILD_ID: buildId },
  // Test 16: no remote image hosts at all. Only the one local test image may be optimized.
  images: {
    remotePatterns: [],
    localPatterns: [{ pathname: '/test-image.png' }],
    qualities: [75],
    formats: ['image/webp'],
  },
  // Test 18: config-level redirect, rewrite and header.
  async redirects() {
    return [{ source: '/tests/config-redirect', destination: '/tests/static', permanent: false }]
  },
  async rewrites() {
    return [{ source: '/tests/config-rewrite', destination: '/tests/config-rewrite-target' }]
  },
  reactStrictMode: true,
  // Security: do not advertise the framework in an X-Powered-By header.
  poweredByHeader: false,
  // Applied to every route at the framework level. proxy.ts overrides the CSP with a
  // nonce-based one for dynamically rendered pages.
  async headers() {
    const base = [...BASE_SECURITY_HEADERS]
    return [
      {
        source: '/tests/config-headers',
        headers: [{ key: 'x-compat-config-header', value: 'present' }],
      },
      {
        source: '/api/:path*',
        headers: [...base, { key: 'Content-Security-Policy', value: API_CSP }],
      },
      {
        source: '/((?!api/).*)',
        headers: [...base, { key: 'Content-Security-Policy', value: FALLBACK_CSP }],
      },
    ]
  },
  ...(output === 'standalone' || output === 'export' ? { output } : {}),
}

export default nextConfig
