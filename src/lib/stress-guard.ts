import { NextResponse } from 'next/server'
import { getEnv } from '@/env'

// Long-running and body-size endpoints can be abused on a public host, so they are
// opt-in: unless ENABLE_STRESS_TESTS=true they answer 404, as if they did not exist.
export function stressDisabledResponse(): NextResponse | null {
  if (getEnv().ENABLE_STRESS_TESTS === 'true') return null
  return NextResponse.json({ error: 'not found' }, { status: 404, headers: noStore })
}

export const noStore = { 'Cache-Control': 'no-store' }
