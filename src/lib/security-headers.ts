// Security headers shared by next.config.ts (all routes) and proxy.ts (nonce override).
// Edge-safe: no Node imports, so it can be loaded from any runtime.

const isDev = process.env.NODE_ENV === 'development'

// Routes rendered per request. ONLY these can carry a per-request CSP nonce, because
// a nonce must be generated per request and Next.js injects it during server rendering.
// Static/ISR HTML is created at build time (no request, so no nonce possible); putting a
// strict nonce policy on those pages would block their own scripts. They use the
// 'unsafe-inline' fallback instead. See SECURITY.md S4 for the trade-off.
export const NONCE_ROUTES: readonly string[] = [
  '/tests/dynamic',
  '/tests/streaming',
  '/tests/cookies',
  '/tests/diagnostics',
  '/tests/env',
  '/tests/error-boundary',
  '/tests/server-action',
]

export function usesNonce(pathname: string): boolean {
  return NONCE_ROUTES.includes(pathname)
}

const COMMON_DIRECTIVES = [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
]

/** Strict policy for dynamically rendered pages. */
export function buildNonceCsp(nonce: string): string {
  return [
    ...COMMON_DIRECTIVES,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
  ].join('; ')
}

/** Weaker fallback for build-time HTML (static/ISR). Still blocks remote scripts, framing, plugins. */
export const FALLBACK_CSP = [
  ...COMMON_DIRECTIVES,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
].join('; ')

/** JSON endpoints never need to load anything. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'"

export const BASE_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  // Legacy equivalent of CSP frame-ancestors, for old browsers.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
]
