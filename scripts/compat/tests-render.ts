import { fail, partial, pass, skipped, testId } from './lib.ts'
import type { TestDef } from './lib.ts'

const ts = (html: string) => testId(html, 'timestamp')

export const renderTests: TestDef[] = [
  {
    id: 'static',
    feature: '1',
    name: 'Static (SSG)',
    async run({ http, sleep }) {
      const a = await http.get('/tests/static')
      if (a.status !== 200) return fail(`status ${a.status}, expected 200`)
      await sleep(1100)
      const b = await http.get('/tests/static')
      const [ta, tb] = [ts(a.text), ts(b.text)]
      if (!ta || !tb) return fail('timestamp element not found in response')
      return ta === tb
        ? pass(`build timestamp unchanged across requests (${ta})`)
        : fail('timestamp changed between requests: page is re-rendered, not static')
    },
  },
  {
    id: 'dynamic',
    feature: '2',
    name: 'Dynamic (SSR)',
    async run({ http, mode, sleep }) {
      if (mode === 'export')
        return skipped('per-request rendering needs a server (not in static export)')
      const stamps: string[] = []
      for (let i = 0; i < 3; i++) {
        const r = await http.get('/tests/dynamic')
        if (r.status !== 200) return fail(`status ${r.status}, expected 200`)
        const t = ts(r.text)
        if (!t) return fail('timestamp element not found in response')
        stamps.push(t)
        await sleep(50)
      }
      return new Set(stamps).size === 3
        ? pass('timestamp changed on every request')
        : fail('timestamp repeated: response is being cached')
    },
  },
  {
    id: 'isr',
    feature: '3',
    name: 'ISR, time-based (30s)',
    async run({ http, mode, fast, sleep }) {
      const a1 = await http.get('/tests/isr')
      if (a1.status !== 200) return fail(`status ${a1.status}, expected 200`)
      await sleep(1500)
      let a2 = await http.get('/tests/isr')
      if (ts(a1.text) !== ts(a2.text)) {
        // The window may have expired exactly between the two reads; read once more.
        await sleep(1500)
        const a3 = await http.get('/tests/isr')
        if (ts(a2.text) !== ts(a3.text))
          return partial('timestamp changes on every request: page is not cached')
        a2 = a3
      }
      const base = ts(a2.text)
      if (!base) return fail('timestamp element not found in response')
      if (mode === 'export')
        return partial(
          'static export: page is frozen at build time, ISR revalidation is unsupported',
        )
      if (fast)
        return partial('stable within the window; revalidation after 30s not checked (--fast)')

      await sleep(32_000)
      const b1 = await http.get('/tests/isr')
      if (ts(b1.text) !== base)
        return pass('regenerated after the 30s window (blocking revalidation)')
      await sleep(4000)
      const b2 = await http.get('/tests/isr')
      if (ts(b2.text) !== base)
        return pass('stale-while-revalidate: refreshed on the request after the window')
      await sleep(8000)
      const b3 = await http.get('/tests/isr')
      return ts(b3.text) !== base
        ? partial('revalidated, but took more than ~4s after the window')
        : fail('not regenerated ~44s after first read: time-based ISR is not working')
    },
  },
  {
    id: 'revalidate',
    feature: '4',
    name: 'On-demand revalidation (path + tag)',
    async run({ http, mode, secrets, sleep }) {
      if (mode === 'export') return skipped('route handlers need a server (not in static export)')
      const path = '/api/tests/revalidate'

      const get = await http.get(path)
      if (get.status === 200) return fail('GET succeeded: endpoint must be POST-only')
      const noToken = await http.get(path, { method: 'POST' })
      if (noToken.status !== 401)
        return fail(`POST without token returned ${noToken.status}, expected 401`)
      const bad = await http.get(path, {
        method: 'POST',
        headers: { 'x-revalidate-token': 'wrong-token-placeholder' },
      })
      if (bad.status !== 401)
        return fail(`POST with wrong token returned ${bad.status}, expected 401`)
      // A dummy value, never the real token: URLs are logged by proxies and CDNs.
      const qs = await http.get(`${path}?token=dummy-not-the-token`, { method: 'POST' })
      if (qs.status !== 401)
        return fail(`POST with query-string token returned ${qs.status}, expected 401`)

      if (!secrets.revalidateToken) {
        return partial(
          'auth checks passed; success path untested (set REVALIDATE_TOKEN in the runner environment)',
        )
      }

      const isrBefore = ts(await http.get('/tests/isr').then((r) => r.text))
      const cacheBefore = testId((await http.get('/tests/fetch-cache')).text, 'detail-cachedValue')
      const ok = await http.get(path, {
        method: 'POST',
        headers: { 'x-revalidate-token': secrets.revalidateToken },
      })
      if (ok.status === 401)
        return fail('valid token rejected: runner REVALIDATE_TOKEN differs from the host value')
      if (ok.status !== 200) return fail(`valid POST returned ${ok.status}, expected 200`)

      let pathOk = false
      let tagOk = false
      for (let i = 0; i < 3 && !(pathOk && tagOk); i++) {
        await sleep(1000)
        if (!pathOk) pathOk = ts((await http.get('/tests/isr')).text) !== isrBefore
        if (!tagOk) {
          const now = testId((await http.get('/tests/fetch-cache')).text, 'detail-cachedValue')
          tagOk = now !== undefined && !now.startsWith('error:') && now !== cacheBefore
        }
      }
      if (pathOk && tagOk)
        return pass('auth enforced; revalidatePath and revalidateTag both took effect')
      if (pathOk)
        return partial('revalidatePath worked; revalidateTag did not refresh the cached fetch')
      if (tagOk) return partial('revalidateTag worked; revalidatePath did not refresh the ISR page')
      return fail('endpoint returned 200 but neither the ISR page nor the cached fetch changed')
    },
  },
  {
    id: 'dynamic-routes',
    feature: '5',
    name: 'Dynamic routes + generateStaticParams',
    async run({ http, mode }) {
      const alpha = await http.get('/tests/dynamic-routes/alpha')
      const beta = await http.get('/tests/dynamic-routes/beta')
      if (alpha.status !== 200 || beta.status !== 200) {
        return fail(`prebuilt paths returned ${alpha.status}/${beta.status}, expected 200/200`)
      }
      const unknown = await http.get('/tests/dynamic-routes/not-a-real-slug')
      if (unknown.status !== 404)
        return fail(`unknown path returned ${unknown.status}, expected a real 404`)

      const g1 = await http.get('/tests/dynamic-routes/gamma')
      if (mode === 'export') {
        return g1.status === 404
          ? partial(
              'prebuilt paths and 404 work; on-demand path (gamma) cannot exist in a static export',
            )
          : fail('on-demand path unexpectedly served from a static export')
      }
      if (g1.status !== 200) return fail(`on-demand path returned ${g1.status}, expected 200`)
      const g2 = await http.get('/tests/dynamic-routes/gamma')
      return ts(g1.text) === ts(g2.text)
        ? pass('prebuilt paths 200, on-demand path generated and cached, unknown path 404')
        : partial(
            'on-demand path works but is re-rendered every time (not cached after first generation)',
          )
    },
  },
  {
    id: 'streaming',
    feature: '6',
    name: 'Streaming + Suspense',
    async run({ http, mode }) {
      if (mode === 'export') return skipped('streaming needs a server (not in static export)')
      const res = await http.raw('/tests/streaming', { timeoutMs: 30_000 })
      if (res.status !== 200 || !res.body)
        return fail(`status ${res.status}, expected 200 with a body`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      const started = Date.now()
      let buffer = ''
      let shellAt: number | undefined
      let slowAt: number | undefined
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const elapsed = Date.now() - started
        if (shellAt === undefined && buffer.includes('data-testid="shell"')) shellAt = elapsed
        if (slowAt === undefined && buffer.includes('data-testid="slow-result"')) slowAt = elapsed
      }
      if (shellAt === undefined) return fail('shell markup not found in response')
      if (slowAt === undefined) return fail('slow component never arrived')
      const gap = slowAt - shellAt
      if (shellAt < 2000 && gap >= 2000)
        return pass(`shell at ${shellAt}ms, slow component ${gap}ms later`)
      return partial(
        `response was buffered: shell at ${shellAt}ms, slow part at ${slowAt}ms (no progressive streaming)`,
      )
    },
  },
  {
    id: 'fetch-cache',
    feature: '7',
    name: 'Fetch caching (cached vs uncached)',
    async run({ http, mode }) {
      if (mode === 'export') return skipped('needs a server (not in static export)')
      const a = await http.get('/tests/fetch-cache')
      if (a.status !== 200) return fail(`status ${a.status}, expected 200`)
      const b = await http.get('/tests/fetch-cache')
      const [ca, cb] = [testId(a.text, 'detail-cachedValue'), testId(b.text, 'detail-cachedValue')]
      const [ua, ub] = [
        testId(a.text, 'detail-uncachedValue'),
        testId(b.text, 'detail-uncachedValue'),
      ]
      if (!ca || !cb || !ua || !ub) return fail('result elements not found in response')
      if ([ca, cb, ua, ub].some((v) => v.startsWith('error:'))) {
        return fail(
          'page could not reach its own data source; set SELF_ORIGIN on the host to its public URL',
        )
      }
      if (ca !== cb && ua !== ub)
        return partial('neither fetch is cached: the Data Cache does not persist between requests')
      if (ca !== cb) return partial('cached fetch changed between requests (cache not persisting)')
      if (ua === ub)
        return fail('uncached fetch returned the same value twice (it is being cached)')
      return pass('cached value stable, uncached value changed on every request')
    },
  },
  {
    id: 'security-headers',
    feature: 'S',
    name: 'Security headers delivered',
    async run({ http, mode, variant }) {
      const targets =
        variant === 'cache-components'
          ? ['/tests/cache-components']
          : mode === 'export'
            ? ['/tests/static']
            : ['/tests/static', '/tests/dynamic', '/api/tests/node-route']
      const missing: string[] = []
      const warnings: string[] = []
      for (const path of targets) {
        const r = await http.get(path)
        const h = r.headers
        const csp = h.get('content-security-policy') ?? ''
        const checks: Array<[string, boolean]> = [
          [
            'strict-transport-security',
            /max-age=\d{7,}/.test(h.get('strict-transport-security') ?? ''),
          ],
          [
            'x-content-type-options',
            (h.get('x-content-type-options') ?? '').toLowerCase() === 'nosniff',
          ],
          ['referrer-policy', !!h.get('referrer-policy')],
          ['permissions-policy', !!h.get('permissions-policy')],
          ["csp frame-ancestors 'none'", /frame-ancestors\s+'none'/.test(csp)],
        ]
        for (const [name, ok] of checks) if (!ok) missing.push(`${path} ${name}`)
        if (
          path === '/tests/dynamic' &&
          !(/'nonce-/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp))
        ) {
          warnings.push('dynamic page CSP is not nonce-based')
        }
        if (h.get('x-powered-by')) warnings.push(`${path} exposes x-powered-by`)
      }
      if (missing.length > 0) {
        const shown = missing.slice(0, 5).join('; ')
        return fail(
          `missing/weak: ${shown}${missing.length > 5 ? ` (+${missing.length - 5} more)` : ''}`,
        )
      }
      if (warnings.length > 0) return partial([...new Set(warnings)].join('; '))
      return pass(`all required headers present on ${targets.length} route(s)`)
    },
  },
]
