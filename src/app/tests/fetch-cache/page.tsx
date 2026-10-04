import { connection } from 'next/server'
import { z } from 'zod'
import { ResultBlock } from '@/components/ResultBlock'
import { getEnv } from '@/env'
import { FETCH_TAG } from '@/lib/constants'
import { makeResult, resultSchema } from '@/lib/result'

function selfOrigin(): string {
  // Trusted config only. Never build this from the request's Host header (SSRF).
  const env = getEnv()
  return env.SELF_ORIGIN ?? `http://127.0.0.1:${env.PORT}`
}

// `variant` only changes the URL. Without it React de-duplicates the two identical GETs inside
// one render, which would make the cached and uncached reads look identical.
async function readValue(
  variant: 'cached' | 'uncached',
  init: RequestInit & { next?: { tags: string[]; revalidate?: number } },
) {
  try {
    const res = await fetch(`${selfOrigin()}/api/tests/fetch-source?variant=${variant}`, init)
    if (!res.ok) return `error:status-${res.status}`
    const parsed = resultSchema.safeParse(await res.json())
    const value = parsed.success ? parsed.data.details.value : undefined
    return z.string().safeParse(value).data ?? 'error:bad-shape'
  } catch {
    // Generic on purpose: no URLs or stack traces in output.
    return 'error:unreachable (set SELF_ORIGIN)'
  }
}

export default async function FetchCachePage() {
  await connection()
  const cached = await readValue('cached', { cache: 'force-cache', next: { tags: [FETCH_TAG] } })
  const uncached = await readValue('uncached', { cache: 'no-store' })
  return (
    <ResultBlock
      result={makeResult('fetch-cache', 'dynamic page + data cache', {
        cachedValue: cached,
        uncachedValue: uncached,
      })}
    />
  )
}
