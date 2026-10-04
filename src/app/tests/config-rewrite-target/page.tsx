import { ResultBlock } from '@/components/ResultBlock'
import { makeResult } from '@/lib/result'

// Reached only through the next.config rewrite from /tests/config-rewrite.
export default function ConfigRewriteTarget() {
  return (
    <ResultBlock result={makeResult('config-rewrite', 'static (reached via config rewrite)')} />
  )
}
