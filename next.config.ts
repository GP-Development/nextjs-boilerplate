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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Security: do not advertise the framework in an X-Powered-By header.
  poweredByHeader: false,
  // Applied to every route at the framework level. proxy.ts overrides the CSP with a
  // nonce-based one for dynamically rendered pages.
  async headers() {
    const base = [...BASE_SECURITY_HEADERS]
    return [
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
