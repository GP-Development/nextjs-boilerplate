import { ResultBlock } from '@/components/ResultBlock'
import { makeResult } from '@/lib/result'

// The response for this path carries a custom header added in next.config.ts headers().
export default function ConfigHeadersPage() {
  return <ResultBlock result={makeResult('config-headers', 'static + config header')} />
}
