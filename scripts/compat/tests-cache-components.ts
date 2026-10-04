import { fail, partial, pass, skipped, testId } from './lib.ts'
import type { TestDef } from './lib.ts'

// Test 8. Cache Components is stable in Next.js 16, but it is a global flag that conflicts with
// the Edge runtime export and the classic `revalidate`/`dynamic` segment configs, so it is a
// separate app (variants/cache-components). Deploy that app, then run with --variant cache-components.
export const cacheComponentTests: TestDef[] = [
  {
    id: 'cache-components',
    feature: '8',
    name: 'Cache Components / "use cache" / PPR',
    async run({ http, mode, variant, sleep }) {
      if (variant !== 'cache-components') {
        return skipped(
          'separate app: deploy variants/cache-components and run with --variant cache-components',
        )
      }
      if (mode === 'export') return skipped('needs a server (not in static export)')
      const path = '/tests/cache-components'

      // 1) Content: cached block must be stable, dynamic block must change.
      const a = await http.get(path)
      if (a.status !== 200) return fail(`status ${a.status}, expected 200`)
      await sleep(1100)
      const b = await http.get(path)
      const [ca, cb] = [testId(a.text, 'cached-timestamp'), testId(b.text, 'cached-timestamp')]
      const [da, db] = [testId(a.text, 'dynamic-timestamp'), testId(b.text, 'dynamic-timestamp')]
      if (!ca || !cb || !da || !db) return fail('expected cached/dynamic elements not found')
      if (ca !== cb) return fail('"use cache" block changed between requests: cache not working')
      if (da === db) return fail('dynamic block repeated: it is being cached or prerendered')

      // 2) Delivery: static shell first, dynamic hole streamed ~2s later.
      const res = await http.raw(path, { timeoutMs: 30_000 })
      const postponed = res.headers.get('x-nextjs-postponed') === '1'
      if (!res.body) return fail('no response body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      const started = Date.now()
      let buffer = ''
      let shellAt: number | undefined
      let dynAt: number | undefined
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const t = Date.now() - started
        if (shellAt === undefined && buffer.includes('data-testid="shell"')) shellAt = t
        if (dynAt === undefined && buffer.includes('data-testid="dynamic-timestamp"')) dynAt = t
      }
      if (shellAt === undefined || dynAt === undefined)
        return fail('shell or dynamic content missing from stream')
      if (shellAt < 1500 && dynAt - shellAt >= 1500) {
        return pass(
          `cached block stable, dynamic block fresh; shell at ${shellAt}ms, dynamic part ${dynAt - shellAt}ms later${postponed ? ' (PPR header present)' : ''}`,
        )
      }
      return partial(
        `content semantics correct, but response was buffered (shell ${shellAt}ms, dynamic ${dynAt}ms): PPR streaming not delivered by this host`,
      )
    },
  },
]
