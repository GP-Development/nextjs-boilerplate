import { makeResult } from '@/lib/result'

// Edge runtime route handler. Hosts without an edge runtime may run this as Node or fail;
// that difference is exactly what this test measures.
export const runtime = 'edge'

export async function GET() {
  const actual =
    typeof (globalThis as { EdgeRuntime?: string }).EdgeRuntime === 'string' ? 'edge' : 'node'
  return Response.json(
    makeResult('edge-route', 'route handler (edge)', { actualRuntime: actual }),
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
