import type { NextConfig } from 'next'

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
  ...(output === 'standalone' || output === 'export' ? { output } : {}),
}

export default nextConfig
