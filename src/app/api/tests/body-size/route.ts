import { NextResponse } from 'next/server'
import { readCapped } from '@/lib/body'
import { makeResult } from '@/lib/result'
import { noStore, stressDisabledResponse } from '@/lib/stress-guard'

// Server-side cap. Kept below Next.js's 10 MB proxy buffering size, and this route is
// excluded from the proxy matcher (src/proxy.ts), so the body is streamed, never buffered.
const MAX_BODY_BYTES = 8 * 1024 * 1024

export async function POST(request: Request) {
  const disabled = stressDisabledResponse()
  if (disabled) return disabled

  const body = await readCapped(request, MAX_BODY_BYTES, { keepText: false })
  if (!body.ok) {
    return NextResponse.json(
      { error: 'payload too large', maxBytes: MAX_BODY_BYTES },
      { status: 413, headers: noStore },
    )
  }
  return NextResponse.json(
    makeResult('body-size', 'route handler (node)', {
      receivedBytes: body.bytes,
      maxBytes: MAX_BODY_BYTES,
    }),
    { headers: noStore },
  )
}
