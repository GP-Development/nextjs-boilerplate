import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeResult } from '@/lib/result'
import { noStore, stressDisabledResponse } from '@/lib/stress-guard'

// Hosts enforce their own timeouts (Vercel reads maxDuration; others have fixed limits).
export const maxDuration = 60

const MAX_SECONDS = 60
const MAX_CONCURRENT = 5 // per instance, best effort
let running = 0

const querySchema = z.object({
  seconds: z.coerce.number().int().min(1).max(MAX_SECONDS),
})

export async function GET(request: Request) {
  const disabled = stressDisabledResponse()
  if (disabled) return disabled

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  )
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request' }, { status: 400, headers: noStore })
  }
  if (running >= MAX_CONCURRENT) {
    return NextResponse.json({ error: 'busy' }, { status: 429, headers: noStore })
  }

  running++
  const started = Date.now()
  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, parsed.data.seconds * 1000)
      // Stop waiting if the client disconnects, so abandoned requests free their slot.
      request.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  } finally {
    running--
  }

  return NextResponse.json(
    makeResult('long-running', 'route handler (node)', {
      requestedSeconds: parsed.data.seconds,
      elapsedMs: Date.now() - started,
    }),
    { headers: noStore },
  )
}
