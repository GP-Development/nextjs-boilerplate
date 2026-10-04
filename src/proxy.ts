import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { buildNonceCsp, usesNonce } from '@/lib/security-headers'

// Next.js 16 renamed middleware.ts -> proxy.ts (Node runtime only).
//
// SECURITY: proxy is NOT an authorization boundary here or anywhere in this project.
// CVE-2025-29927 showed that middleware could be skipped via a crafted header. Anything
// that needs protecting (e.g. the revalidate endpoint) checks its own credentials in the
// route handler itself. See SECURITY.md S5.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

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
    return response
  }

  return NextResponse.next()
}

export const config = {
  // Skip framework assets; they are static files and get headers from next.config.ts.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
