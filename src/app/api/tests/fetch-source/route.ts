import { NextResponse } from 'next/server'
import { makeResult } from '@/lib/result'

// Local data source for the fetch-cache test: a different value on every call, so the
// test can tell a cached fetch (same value) from an uncached one (new value).
export async function GET() {
  const body = makeResult('fetch-source', 'route handler (node)', { value: crypto.randomUUID() })
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
