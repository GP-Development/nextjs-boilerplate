import { ResultBlock } from '@/components/ResultBlock'
import { makeResult } from '@/lib/result'

// No request-time APIs, so Next.js prerenders this at build. The timestamp is the BUILD time.
export default function StaticPage() {
  return <ResultBlock result={makeResult('static', 'static (build time)')} />
}
