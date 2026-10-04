import path from 'node:path'
import type { NextConfig } from 'next'
// next.config.ts is loaded by Node (not bundled), so importing the shared module from the repo root is fine.
import { BASE_SECURITY_HEADERS, FALLBACK_CSP } from '../../src/lib/security-headers'

// TEST 8 - Cache Components. `cacheComponents` is a global flag: it makes data fetching
// dynamic by default, enables the "use cache" directive and Partial Prerendering, and it
// forbids `runtime = 'edge'` and the `revalidate` / `dynamic` route segment configs. That is
// why this lives in its own app instead of the main one (see README).
const nextConfig: NextConfig = {
  cacheComponents: true,
  poweredByHeader: false,
  // This app has only pages and layouts (.tsx). Next.js locates proxy files using these
  // extensions, so excluding ts/js stops it from picking up the MAIN app's src/proxy.ts, which
  // sits at the npm-workspace root that Turbopack needs for the hoisted node_modules.
  pageExtensions: ['tsx', 'jsx'],
  // node_modules is hoisted to the repo root by npm workspaces, so Turbopack's root must be the repo root.
  turbopack: { root: path.resolve(process.cwd(), '../..') },
  async headers() {
    return [
      {
        source: '/:path*',
        // A prerendered static shell exists before any request, so it cannot carry a
        // per-request CSP nonce. Same documented trade-off as the main app (SECURITY.md S4).
        headers: [
          ...BASE_SECURITY_HEADERS,
          { key: 'Content-Security-Policy', value: FALLBACK_CSP },
        ],
      },
    ]
  },
}

export default nextConfig
