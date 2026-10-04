import { ResultBlock } from '@/components/ResultBlock'
import { makeResult } from '@/lib/result'

// Reached only through the proxy rewrite from /tests/proxy-rewrite.
export default function ProxyRewriteTarget() {
  return <ResultBlock result={makeResult('proxy-rewrite', 'static (reached via rewrite)')} />
}
