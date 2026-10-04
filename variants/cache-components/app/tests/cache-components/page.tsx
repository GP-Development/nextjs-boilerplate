import { Suspense } from 'react'
import { cacheLife } from 'next/cache'
import { connection } from 'next/server'

// TEST 8: three kinds of content on one route.
//   1. static shell      - plain markup, prerendered at build, sent immediately
//   2. "use cache" block - computed once, reused until its cache entry expires
//   3. dynamic block     - rendered per request and streamed into the shell (PPR "hole")
const DYNAMIC_DELAY_MS = 2000

async function CachedBlock() {
  'use cache'
  cacheLife({ stale: 30, revalidate: 30, expire: 3600 })
  return (
    <p>
      cached at <time data-testid="cached-timestamp">{new Date().toISOString()}</time>
    </p>
  )
}

async function DynamicBlock() {
  await connection() // request-time data: excludes this component from the static shell
  await new Promise((resolve) => setTimeout(resolve, DYNAMIC_DELAY_MS))
  return (
    <p>
      rendered at <time data-testid="dynamic-timestamp">{new Date().toISOString()}</time>
    </p>
  )
}

export default function CacheComponentsPage() {
  return (
    <section data-testid="result" data-feature="cache-components">
      <h1>cache-components</h1>
      <p>
        render mode: <strong data-testid="render-mode">partial prerender (cacheComponents)</strong>
      </p>
      <p data-testid="shell">static shell</p>
      <CachedBlock />
      <Suspense fallback={<p data-testid="fallback">loading dynamic block…</p>}>
        <DynamicBlock />
      </Suspense>
    </section>
  )
}
