// Shared building blocks for the compat runner. Runs on Node's built-in TypeScript
// type-stripping, so only "erasable" TS syntax is used (no enums, no parameter properties).

export type Status = 'PASS' | 'FAIL' | 'PARTIAL' | 'SKIPPED'
export type Outcome = { status: Status; reason: string }
export type Mode = 'server' | 'export'

export const pass = (reason: string): Outcome => ({ status: 'PASS', reason })
export const fail = (reason: string): Outcome => ({ status: 'FAIL', reason })
export const partial = (reason: string): Outcome => ({ status: 'PARTIAL', reason })
export const skipped = (reason: string): Outcome => ({ status: 'SKIPPED', reason })

export type Secrets = { revalidateToken: string | undefined; serverProbe: string | undefined }

export type HttpResult = { status: number; headers: Headers; text: string; ms: number }
export type Http = {
  base: URL
  /** Fetch and buffer a response as text. Never follows redirects. */
  get(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<HttpResult>
  /** Raw Response (for streaming and binary). Never follows redirects. */
  raw(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response>
}

export type Ctx = {
  http: Http
  mode: Mode
  variant: 'main' | 'cache-components'
  fast: boolean
  longSeconds: number[]
  bodySizes: number[]
  secrets: Secrets
  sleep(ms: number): Promise<void>
}

export type TestDef = {
  id: string
  feature: string // matches the numbering in TESTS.md
  name: string
  run(ctx: Ctx): Promise<Outcome>
}

export function makeHttp(base: URL): Http {
  function resolveUrl(path: string): URL {
    // Origin pinning: the runner only ever talks to the URL the user passed.
    if (!path.startsWith('/')) throw new Error('internal: path must start with "/"')
    const url = new URL(path, base)
    if (url.origin !== base.origin) throw new Error('internal: refusing cross-origin request')
    return url
  }
  async function raw(path: string, init: RequestInit & { timeoutMs?: number } = {}) {
    const { timeoutMs = 30_000, headers, ...rest } = init
    const merged = new Headers(headers)
    if (!merged.has('user-agent')) merged.set('user-agent', 'nextjs-compat-runner/1')
    return fetch(resolveUrl(path), {
      redirect: 'manual', // never follow: a redirect could point to another host
      signal: AbortSignal.timeout(timeoutMs),
      ...rest,
      headers: merged,
    })
  }
  return {
    base,
    raw,
    async get(path, init) {
      const started = Date.now()
      const res = await raw(path, init)
      const text = await res.text()
      return { status: res.status, headers: res.headers, text, ms: Date.now() - started }
    },
  }
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
}
export const decodeEntities = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (m) => ENTITIES[m] ?? m)

/** Text content of the first element with this data-testid, or undefined. */
export function testId(html: string, id: string): string | undefined {
  const m = html.match(new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`))
  return m?.[1] === undefined ? undefined : decodeEntities(m[1])
}

/** All same-origin /_next script URLs referenced by the HTML. */
export function scriptUrls(html: string): string[] {
  const urls = new Set<string>()
  for (const m of html.matchAll(/<script[^>]*\ssrc="(\/_next\/[^"]+)"/g))
    if (m[1]) urls.add(decodeEntities(m[1]))
  return [...urls]
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'request timed out'
    const cause = (error as { cause?: { code?: string } }).cause?.code
    return cause ? `${error.name}: ${cause}` : `${error.name}: ${error.message}`
  }
  return 'unknown error'
}

/** Removes every known secret value from text before it is printed or written. */
export function makeRedactor(secrets: Secrets): (text: string) => string {
  const values = [secrets.revalidateToken, secrets.serverProbe].filter(
    (v): v is string => typeof v === 'string' && v.length >= 6,
  )
  return (text) => values.reduce((acc, v) => acc.split(v).join('[REDACTED]'), text)
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function humanBytes(n: number): string {
  if (n >= 1024 * 1024) return `${+(n / 1024 / 1024).toFixed(1)} MiB`
  if (n >= 1024) return `${+(n / 1024).toFixed(1)} KiB`
  return `${n} B`
}
