import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { buildNonceCsp, usesNonce } from '@/lib/security-headers'

// Next.js 16 renamed middleware.ts -> proxy.ts (Node runtime only).
//
// SECURITY: proxy is NOT an authorization boundary here or anywhere in this project.
// CVE-2025-29927 showed that middleware could be skipped via a crafted header. Anything
// that needs protecting (e.g. the revalidate endpoint) checks its own credentials in the
// route handler itself. See SECURITY.md S5.

const PROXY_HEADER = 'x-compat-proxy'

function mark(response: NextResponse): NextResponse {
  response.headers.set(PROXY_HEADER, 'active')
  return response
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Test 12: one redirect and one rewrite. Destinations are fixed constants, never user
  // input, so there is no open redirect.
  if (pathname === '/tests/proxy-redirect') {
    const url = request.nextUrl.clone()
    url.pathname = '/tests/static'
    return mark(NextResponse.redirect(url, 307))
  }
  if (pathname === '/tests/proxy-rewrite') {
    const url = request.nextUrl.clone()
    url.pathname = '/tests/proxy-rewrite-target'
    return mark(NextResponse.rewrite(url))
  }

  if (usesNonce(pathname)) {
    // Fresh, unguessable value for every request.
    const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
    const csp = buildNonceCsp(nonce)

    // Next.js reads the nonce from the CSP header on the REQUEST while rendering and
    // stamps it onto its own inline scripts.
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('Content-Security-Policy', csp)

    const response = NextResponse.next({ request: { headers: requestHeaders } })
    response.headers.set('Content-Security-Policy', csp)
    return mark(response)
  }

  return mark(NextResponse.next())
}

export const config = {
  // Skipped: framework assets (static files; headers come from next.config.ts) and the
  // body-size endpoint (when proxy matches a route Next.js buffers up to 10 MB of the request
  // body in memory and silently truncates beyond it, which would corrupt that test).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/tests/body-size).*)'],
}
