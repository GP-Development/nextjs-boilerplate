import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readCapped } from '@/lib/body'
import { makeResult } from '@/lib/result'

const MAX_BODY = 4 * 1024
const bodySchema = z.object({ name: z.string().trim().min(1).max(50) }).strict()

export async function GET() {
  return NextResponse.json(makeResult('node-route', 'route handler (node)', { method: 'GET' }), {
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function POST(request: Request) {
  const fail = (status: number) => NextResponse.json({ error: 'invalid request' }, { status }) // generic on purpose

  if (!request.headers.get('content-type')?.startsWith('application/json')) return fail(415)
  const body = await readCapped(request, MAX_BODY, { keepText: true })
  if (!body.ok) return fail(body.status)

  let json: unknown
  try {
    json = JSON.parse(body.text)
  } catch {
    return fail(400)
  }
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) return fail(400)

  return NextResponse.json(
    makeResult('node-route', 'route handler (node)', {
      method: 'POST',
      echoName: parsed.data.name,
    }),
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
