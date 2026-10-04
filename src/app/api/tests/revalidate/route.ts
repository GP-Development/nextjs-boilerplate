import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { getEnv } from '@/env'
import { safeEqual } from '@/lib/constant-time'
import { FETCH_TAG } from '@/lib/constants'
import { makeResult } from '@/lib/result'

// The ONLY protected endpoint in this project. It checks its own credentials; it does not
// rely on proxy.ts (see SECURITY.md S5).
//   - POST only: other methods are not exported, so Next.js answers 405.
//   - Token travels in a header, never the query string (URLs end up in logs).
//   - Constant-time comparison; generic 401; nothing is logged.
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  try {
    const provided = request.headers.get('x-revalidate-token') ?? ''
    if (!safeEqual(provided, getEnv().REVALIDATE_TOKEN)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE })
    }

    revalidatePath('/tests/isr')
    // { expire: 0 } = never serve stale; the next request blocks on fresh data.
    revalidateTag(FETCH_TAG, { expire: 0 })

    return NextResponse.json(
      makeResult('revalidate', 'route handler (node)', {
        revalidatedPath: '/tests/isr',
        revalidatedTag: FETCH_TAG,
      }),
      { headers: NO_STORE },
    )
  } catch {
    // Generic message: never expose internals.
    return NextResponse.json({ error: 'internal error' }, { status: 500, headers: NO_STORE })
  }
}
