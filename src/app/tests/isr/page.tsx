import { ResultBlock } from '@/components/ResultBlock'
import { makeResult } from '@/lib/result'

// Time-based ISR: served from cache, regenerated at most every 30 seconds.
export const revalidate = 30

export default function IsrPage() {
  return (
    <ResultBlock result={makeResult('isr', 'isr (revalidate 30s)', { revalidateSeconds: 30 })} />
  )
}
