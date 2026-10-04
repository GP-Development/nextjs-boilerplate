import { Suspense } from 'react'
import { connection } from 'next/server'
import { makeResult } from '@/lib/result'

const SLOW_MS = 3000

async function SlowPart() {
  await connection() // request-time rendering, so it streams instead of being prerendered
  await new Promise((resolve) => setTimeout(resolve, SLOW_MS))
  return (
    <p data-testid="slow-result">
      slow component finished at <time>{makeResult('streaming', 'stream').timestamp}</time>
    </p>
  )
}

export default function StreamingPage() {
  return (
    <section data-testid="result" data-feature="streaming">
      <h1>streaming</h1>
      <p data-testid="shell">shell rendered first</p>
      <Suspense fallback={<p data-testid="fallback">loading slow component…</p>}>
        <SlowPart />
      </Suspense>
    </section>
  )
}
