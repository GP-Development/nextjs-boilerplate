import { createHash } from 'node:crypto'
import { decodeEntities, fail, partial, pass, scriptUrls, skipped, testId } from './lib.ts'
import type { Ctx, TestDef } from './lib.ts'

const NEEDS_SERVER = 'needs a server (not in static export)'

/** Downloads same-origin client scripts referenced by a page, to scan them for strings. */
async function clientCode(http: Ctx['http'], html: string): Promise<string> {
  const parts: string[] = []
  for (const url of scriptUrls(html).slice(0, 40)) {
    try {
      parts.push((await http.get(url)).text)
    } catch {
      // A missing chunk only weakens the scan; the test reports what it could check.
    }
  }
  return parts.join('\n')
}

export const platformTests: TestDef[] = [
  {
    id: 'image',
    feature: '16',
    name: 'next/image optimization (no remote hosts)',
    async run({ http, mode }) {
      const page = await http.get('/tests/image')
      if (page.status !== 200) return fail(`page returned ${page.status}, expected 200`)
      const src = decodeEntities(page.text.match(/<img[^>]*\ssrc="([^"]+)"/)?.[1] ?? '')
      if (!src) return fail('<img> not found on page')
      if (mode === 'export') {
        return partial(
          `static export serves the original image unoptimized (src=${src.startsWith('/_next/image') ? 'optimizer' : 'direct'})`,
        )
      }
      if (!src.startsWith('/_next/image')) return fail('image is not routed through the optimizer')

      const original = await http
        .get('/test-image.png')
        .then((r) => r.headers.get('content-length'))
      const res = await http.raw(src, { headers: { accept: 'image/webp,*/*' } })
      const bytes = (await res.arrayBuffer()).byteLength
      if (res.status !== 200) return fail(`optimizer returned ${res.status}, expected 200`)

      // Negative checks: the optimizer must refuse remote URLs and values outside the allowlists.
      const refusals: Array<[string, string]> = [
        ['remote URL', '/_next/image?url=https%3A%2F%2Fexample.com%2Fx.png&w=640&q=75'],
        ['unlisted width', '/_next/image?url=%2Ftest-image.png&w=641&q=75'],
        ['unlisted quality', '/_next/image?url=%2Ftest-image.png&w=640&q=50'],
      ]
      for (const [label, path] of refusals) {
        const r = await http.get(path)
        if (r.status === 200)
          return fail(`optimizer served a request with a ${label}: allowlist not enforced`)
      }
      const type = res.headers.get('content-type') ?? ''
      if (!type.includes('webp'))
        return partial(
          `works, but returned ${type || 'unknown type'} instead of WebP (host optimizer differs)`,
        )
      const orig = Number(original)
      return Number.isFinite(orig) && bytes < orig
        ? pass(`WebP, ${bytes} bytes (original ${orig}); remote URL and off-list values refused`)
        : partial(`WebP returned but not smaller than the original (${bytes} vs ${original})`)
    },
  },
  {
    id: 'font',
    feature: '17',
    name: 'next/font (self-hosted Google font)',
    async run({ http }) {
      const page = await http.get('/tests/font')
      if (page.status !== 200) return fail(`page returned ${page.status}, expected 200`)
      if (/fonts\.(googleapis|gstatic)\.com/.test(page.text))
        return fail('page loads the font from Google instead of self-hosting it')
      let font = page.text.match(/\/_next\/static\/media\/[^"')\s]+\.woff2/)?.[0]
      if (!font) {
        for (const m of page.text.matchAll(/href="(\/_next\/static\/[^"]+\.css)"/g)) {
          const css = await http.get(m[1] ?? '')
          font = css.text.match(/\/_next\/static\/media\/[^"')\s]+\.woff2/)?.[0]
          if (font) break
        }
      }
      if (!font) return fail('no self-hosted .woff2 reference found in HTML or CSS')
      const res = await http.raw(font)
      await res.arrayBuffer()
      if (res.status !== 200) return fail(`font file returned ${res.status}`)
      const type = res.headers.get('content-type') ?? ''
      return /font\/woff2|application\/(font-woff2|octet-stream)/.test(type)
        ? pass('font served from the same origin as woff2')
        : partial(`font served, but with unexpected content-type "${type}"`)
    },
  },
  {
    id: 'config-rules',
    feature: '18',
    name: 'next.config redirects, rewrites, headers',
    async run({ http, mode }) {
      if (mode === 'export')
        return skipped(
          'config redirects/rewrites/headers are not applied in a static export (Next.js warns at build)',
        )
      const problems: string[] = []
      const redirect = await http.get('/tests/config-redirect')
      if (
        redirect.status !== 307 ||
        !(redirect.headers.get('location') ?? '').endsWith('/tests/static')
      ) {
        problems.push(`redirect gave ${redirect.status}`)
      }
      const rewrite = await http.get('/tests/config-rewrite')
      if (rewrite.status !== 200 || !rewrite.text.includes('data-feature="config-rewrite"'))
        problems.push(`rewrite gave ${rewrite.status}`)
      const headers = await http.get('/tests/config-headers')
      if (headers.headers.get('x-compat-config-header') !== 'present')
        problems.push('custom header missing')
      return problems.length === 0
        ? pass('redirect (307), rewrite and custom header all applied')
        : (problems.length === 3 ? fail : partial)(problems.join('; '))
    },
  },
  {
    id: 'env',
    feature: '19',
    name: 'Environment variables (build-time vs server-only)',
    async run({ http, mode, secrets }) {
      if (mode === 'export')
        return skipped('runtime environment needs a server (not in static export)')
      const page = await http.get('/tests/env')
      if (page.status !== 200) return fail(`page returned ${page.status}, expected 200`)
      const clientLabel = testId(page.text, 'public-label-client')
      const serverLabel = testId(page.text, 'public-label-server')
      const present = testId(page.text, 'probe-present')
      const hash = testId(page.text, 'probe-hash')
      if (!clientLabel || !serverLabel || !present)
        return fail('result elements not found in response')
      if (clientLabel !== serverLabel)
        return fail('NEXT_PUBLIC value differs between client and server code')

      const code = await clientCode(http, page.text)
      const notes: string[] = []
      if (secrets.serverProbe) {
        if (page.text.includes(secrets.serverProbe) || code.includes(secrets.serverProbe)) {
          return fail('SERVER-ONLY VALUE FOUND in page HTML or client JavaScript')
        }
        if (present !== 'true')
          return fail('server-only variable is not readable at runtime on the server')
        const expected = createHash('sha256').update(secrets.serverProbe).digest('hex').slice(0, 12)
        if (hash !== expected) notes.push('host SERVER_ONLY_PROBE differs from the runner value')
      } else {
        notes.push('runner SERVER_ONLY_PROBE not set: leak scan and hash check skipped')
      }

      const inBundle = clientLabel.length >= 8 ? code.includes(clientLabel) : undefined
      if (inBundle === false) return fail('NEXT_PUBLIC value is not inlined in the client bundle')
      if (inBundle === undefined)
        notes.push('label shorter than 8 chars: bundle inlining not checked')

      return notes.length === 0
        ? pass(
            'NEXT_PUBLIC inlined in client bundle; server-only value readable on server and absent from client output',
          )
        : partial(notes.join('; '))
    },
  },
  {
    id: 'error-pages',
    feature: '20',
    name: 'Custom not-found and error boundary',
    async run({ http, mode }) {
      const nf = await http.get(`/tests/does-not-exist-${Date.now()}`)
      const notFoundOk =
        nf.status === 404 && (nf.text.includes('data-testid="not-found"') || mode === 'export')
      if (nf.status !== 404) return fail(`unknown route returned ${nf.status}, expected 404`)
      if (mode === 'export') {
        return notFoundOk
          ? partial('404 works; the throwing page cannot exist in a static export')
          : fail('404 response missing')
      }
      if (!notFoundOk) return fail('404 status correct but custom not-found page not rendered')

      const err = await http.get('/tests/error-boundary')
      if (err.text.includes('CANARY-7f3a91')) return fail('error message leaked into the response')
      if (/\bat\s+\S+\s+\([^)]*:\d+:\d+\)/.test(err.text))
        return fail('stack trace leaked into the response')
      if (err.status === 500)
        return pass('custom 404 rendered; thrown error returns 500 with no message or stack leaked')
      return partial(`no leak, but throwing page returned ${err.status} instead of 500`)
    },
  },
  {
    id: 'diagnostics',
    feature: '21',
    name: 'Diagnostics (allowlisted facts only)',
    async run({ http, mode, secrets }) {
      if (mode === 'export') return skipped(NEEDS_SERVER)
      const r = await http.get('/tests/diagnostics')
      if (r.status !== 200) return fail(`status ${r.status}, expected 200`)
      const d = (k: string) => testId(r.text, `detail-${k}`)
      const [node, next, runtime, host, build] = [
        d('nodeVersion'),
        d('nextVersion'),
        d('runtime'),
        d('detectedHost'),
        d('buildId'),
      ]
      if (!node || !next || !runtime || !build) return fail('expected diagnostic fields missing')
      const leaks = [
        'PATH=',
        'HOME=',
        'SECRET',
        'PASSWORD',
        ...[secrets.revalidateToken, secrets.serverProbe].filter((v): v is string => !!v),
      ]
      if (leaks.some((s) => r.text.includes(s)))
        return fail('page appears to expose environment data')
      return pass(
        `node ${node}, next ${next}, runtime ${runtime}, build ${build}, host: ${host ?? 'unknown'}`,
      )
    },
  },
]
