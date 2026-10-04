import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { makeResult } from '@/lib/result'

const COOKIE = 'compat_test'
const noStore = { 'Cache-Control': 'no-store' }

// POST sets the cookie. The value is random and carries no information.
export async function POST() {
  const store = await cookies()
  store.set(COOKIE, crypto.randomUUID(), {
    httpOnly: true, // not readable from page JavaScript
    secure: true, // HTTPS only
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return NextResponse.json(makeResult('cookies', 'route handler (node)', { action: 'set' }), {
    headers: noStore,
  })
}

// GET reports whether the cookie came back on a later request (never its value).
export async function GET() {
  const present = (await cookies()).has(COOKIE)
  return NextResponse.json(
    makeResult('cookies', 'route handler (node)', { action: 'read', cookiePresent: present }),
    { headers: noStore },
  )
}
