import { decodeEntities, fail, humanBytes, partial, pass, skipped, testId } from './lib.ts'
import type { TestDef } from './lib.ts'

const NEEDS_SERVER = 'needs a server (not in static export)'
const JSON_HEADERS = { 'content-type': 'application/json' }
// Must match MAX_BODY_BYTES in src/app/api/tests/body-size/route.ts
const SERVER_BODY_CAP = 8 * 1024 * 1024

function json(text: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(text)
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

export const serverTests: TestDef[] = [
  {
    id: 'node-route',
    feature: '9',
    name: 'Route handler, Node runtime (GET + POST)',
    async run({ http, mode }) {
      if (mode === 'export') return skipped(NEEDS_SERVER)
      const path = '/api/tests/node-route'
      const get = await http.get(path)
      if (get.status !== 200 || json(get.text)?.feature !== 'node-route')
        return fail(`GET returned ${get.status} without the expected JSON`)

      const ok = await http.get(path, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: 'ada' }),
      })
      const echo = (json(ok.text)?.details as Record<string, unknown> | undefined)?.echoName
      if (ok.status !== 200 || echo !== 'ada')
        return fail(`valid POST returned ${ok.status}, expected 200 echoing the name`)

      const cases: Array<[string, string, Record<string, string>, number]> = [
        ['empty name', JSON.stringify({ name: '' }), JSON_HEADERS, 400],
        ['unknown key', JSON.stringify({ name: 'a', extra: 1 }), JSON_HEADERS, 400],
        ['invalid JSON', 'not json', JSON_HEADERS, 400],
        ['wrong content type', 'x', { 'content-type': 'text/plain' }, 415],
      ]
      for (const [label, body, headers, expected] of cases) {
        const r = await http.get(path, { method: 'POST', headers, body })
        if (r.status !== expected) return fail(`${label}: got ${r.status}, expected ${expected}`)
        if (/stack|at .*\(/i.test(r.text))
          return fail(`${label}: response looks like it leaks internals`)
      }
      return pass(
        'GET ok; POST validated by zod (valid 200; empty/extra/invalid/wrong type rejected)',
      )
    },
  },
  {
    id: 'edge-route',
    feature: '10',
    name: 'Route handler, Edge runtime',
    async run({ http, mode }) {
      if (mode === 'export') return skipped(NEEDS_SERVER)
      const r = await http.get('/api/tests/edge-route')
      if (r.status !== 200) return fail(`status ${r.status}, expected 200`)
      const runtime = (json(r.text)?.details as Record<string, unknown> | undefined)?.actualRuntime
      if (runtime === 'edge') return pass('executed on the Edge runtime')
      if (runtime === 'node')
        return partial(
          'route works but executed on the Node runtime (host has no separate Edge runtime)',
        )
      return fail('response did not report its runtime')
    },
  },
  {
    id: 'server-action',
    feature: '11',
    name: 'Server Action (zod-validated form)',
    async run({ http, mode }) {
      if (mode === 'export') return skipped('Server Actions need a server (not in static export)')
      const page = await http.get('/tests/server-action')
      if (page.status !== 200) return fail(`page returned ${page.status}, expected 200`)
      const form = page.text.match(/<form[\s\S]*?<\/form>/)?.[0]
      if (!form) return fail('form not found on page')
      // Replay the form's hidden fields exactly as a browser without JavaScript would.
      const hidden: Array<[string, string]> = []
      for (const m of form.matchAll(/<input type="hidden"([^>]*)>/g)) {
        const attrs = m[1] ?? ''
        const name = attrs.match(/name="([^"]+)"/)?.[1]
        if (name) hidden.push([name, decodeEntities(attrs.match(/value="([^"]*)"/)?.[1] ?? '')])
      }
      const submit = (message: string, origin: string) => {
        const body = new FormData()
        for (const [k, v] of hidden) body.append(k, v)
        body.append('message', message)
        return http.get('/tests/server-action', { method: 'POST', body, headers: { origin } })
      }
      const sameOrigin = http.base.origin

      const good = await submit('hello <i>x</i>', sameOrigin)
      if (good.status !== 200) {
        return fail(
          `same-origin submission returned ${good.status} (host may rewrite Host headers; see serverActions.allowedOrigins)`,
        )
      }
      if (testId(good.text, 'action-status') !== 'ok') return fail('valid input was not accepted')
      if (testId(good.text, 'action-echo') !== 'hello <i>x</i>')
        return fail('echo did not match the submitted value')
      if (good.text.includes('hello <i>x</i>')) return fail('echoed input was not HTML-escaped')

      const bad = await submit('x'.repeat(101), sameOrigin)
      if (testId(bad.text, 'action-status') !== 'error')
        return fail('over-long input was not rejected by zod validation')

      const forged = await submit('hello', 'https://evil.example')
      if (forged.status === 200 && testId(forged.text, 'action-status') === 'ok') {
        return fail(
          'action ran for a forged Origin header: CSRF protection is not active on this host',
        )
      }
      return pass('valid input echoed (escaped), invalid input rejected, forged Origin refused')
    },
  },
  {
    id: 'proxy',
    feature: '12',
    name: 'Proxy (middleware): header, rewrite, redirect',
    async run({ http, mode }) {
      if (mode === 'export') return skipped('proxy needs a server (not in static export)')
      const problems: string[] = []
      const header = await http.get('/tests/static')
      if (header.headers.get('x-compat-proxy') !== 'active')
        problems.push('custom response header missing')

      const redirect = await http.get('/tests/proxy-redirect')
      const location = redirect.headers.get('location') ?? ''
      if (redirect.status !== 307 || !location.endsWith('/tests/static')) {
        problems.push(
          `redirect gave ${redirect.status} -> ${location.slice(0, 40) || 'no location'}`,
        )
      }

      const rewrite = await http.get('/tests/proxy-rewrite')
      if (rewrite.status !== 200 || !rewrite.text.includes('data-feature="proxy-rewrite"')) {
        problems.push(`rewrite gave ${rewrite.status}`)
      }

      // CVE-2025-29927 regression check: this header must NOT make the proxy skip itself.
      const bypass = await http.get('/tests/static', {
        headers: { 'x-middleware-subrequest': 'src/proxy:src/proxy:src/proxy:src/proxy:src/proxy' },
      })
      if (bypass.headers.get('x-compat-proxy') !== 'active')
        problems.push('x-middleware-subrequest bypassed the proxy (CVE-2025-29927 pattern)')

      return problems.length === 0
        ? pass('header added, rewrite and redirect work, bypass header ignored')
        : (problems.length >= 3 ? fail : partial)(problems.join('; '))
    },
  },
  {
    id: 'cookies',
    feature: '13',
    name: 'Cookies (HttpOnly, Secure, SameSite=Lax)',
    async run({ http, mode }) {
      if (mode === 'export') return skipped(NEEDS_SERVER)
      const set = await http.raw('/api/tests/cookies', { method: 'POST' })
      await set.text()
      if (set.status !== 200) return fail(`set returned ${set.status}, expected 200`)
      const line = set.headers.getSetCookie().find((c) => c.startsWith('compat_test='))
      if (!line) return fail('Set-Cookie header missing (host may strip it)')
      const flags = [
        ['HttpOnly', /;\s*HttpOnly/i],
        ['Secure', /;\s*Secure/i],
        ['SameSite=Lax', /;\s*SameSite=Lax/i],
      ] as const
      const lacking = flags.filter(([, re]) => !re.test(line)).map(([n]) => n)
      if (lacking.length > 0) return fail(`cookie lacks: ${lacking.join(', ')}`)

      const value = line.split(';')[0]?.split('=')[1] ?? ''
      const back = await http.get('/api/tests/cookies', {
        headers: { cookie: `compat_test=${value}` },
      })
      const present = (json(back.text)?.details as Record<string, unknown> | undefined)
        ?.cookiePresent
      if (present !== true) return fail('cookie sent back but the server did not see it')
      const without = await http.get('/api/tests/cookies')
      if (
        (json(without.text)?.details as Record<string, unknown> | undefined)?.cookiePresent !==
        false
      ) {
        return fail('server reported a cookie on a request that sent none')
      }
      const page = await http.get('/tests/cookies', { headers: { cookie: `compat_test=${value}` } })
      if (testId(page.text, 'detail-cookiePresent') !== 'true')
        return partial('route handler reads the cookie but server-rendered page did not')
      return pass(
        'Set-Cookie has HttpOnly, Secure, SameSite=Lax; cookie read back in handler and page',
      )
    },
  },
  {
    id: 'long-running',
    feature: '14',
    name: 'Long-running function (timeout probe)',
    async run({ http, mode, longSeconds }) {
      if (mode === 'export') return skipped(NEEDS_SERVER)
      const ok: number[] = []
      let failure = ''
      for (const seconds of longSeconds) {
        try {
          const r = await http.get(`/api/tests/long-running?seconds=${seconds}`, {
            timeoutMs: (seconds + 20) * 1000,
          })
          if (r.status === 404 && ok.length === 0)
            return skipped('endpoint disabled: set ENABLE_STRESS_TESTS=true on the host')
          const elapsed = Number(
            (json(r.text)?.details as Record<string, unknown> | undefined)?.elapsedMs,
          )
          if (r.status !== 200 || !(elapsed >= seconds * 900)) {
            failure = `${seconds}s -> status ${r.status}`
            break
          }
          ok.push(seconds)
        } catch (error) {
          failure = `${seconds}s -> ${error instanceof Error && error.name === 'TimeoutError' ? 'client timeout' : 'connection error'}`
          break
        }
      }
      if (ok.length === 0) return fail(`first probe failed (${failure})`)
      if (failure)
        return partial(
          `completed up to ${Math.max(...ok)}s; failed at ${failure} (host timeout limit)`,
        )
      return pass(
        `completed ${ok.join(', ')}s requests${Math.max(...ok) < 60 ? ' (use --long-seconds to probe up to 60)' : ''}`,
      )
    },
  },
  {
    id: 'body-size',
    feature: '15',
    name: 'Request body size limit',
    async run({ http, mode, bodySizes }) {
      if (mode === 'export') return skipped(NEEDS_SERVER)
      const post = (size: number) =>
        http.get('/api/tests/body-size', {
          method: 'POST',
          body: Buffer.alloc(size, 97),
          headers: { 'content-type': 'application/octet-stream' },
          timeoutMs: 120_000,
        })
      const ok: number[] = []
      let failure = ''
      for (const size of bodySizes) {
        try {
          const r = await post(size)
          if (r.status === 404 && ok.length === 0)
            return skipped('endpoint disabled: set ENABLE_STRESS_TESTS=true on the host')
          const received = Number(
            (json(r.text)?.details as Record<string, unknown> | undefined)?.receivedBytes,
          )
          if (r.status !== 200 || received !== size) {
            failure = `${humanBytes(size)} -> status ${r.status}`
            break
          }
          ok.push(size)
        } catch {
          failure = `${humanBytes(size)} -> connection error`
          break
        }
      }
      if (ok.length === 0) return fail(`smallest probe failed (${failure})`)
      if (failure)
        return partial(
          `accepted up to ${humanBytes(Math.max(...ok))}; rejected at ${failure} (host payload limit)`,
        )

      const over = await post(SERVER_BODY_CAP + 1024 * 1024).catch(() => undefined)
      if (over === undefined || (over.status >= 400 && over.status < 600)) {
        return pass(
          `accepted up to ${humanBytes(Math.max(...ok))}; oversized body refused (${over?.status ?? 'connection closed'})`,
        )
      }
      return fail(
        `oversized body (${humanBytes(SERVER_BODY_CAP + 1024 * 1024)}) was accepted: server-side cap not enforced`,
      )
    },
  },
]
