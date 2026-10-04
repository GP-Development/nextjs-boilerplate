import { connection } from 'next/server'
import { ResultBlock } from '@/components/ResultBlock'
import { makeResult } from '@/lib/result'

export default async function DynamicPage() {
  await connection() // opts this page into per-request rendering
  return <ResultBlock result={makeResult('dynamic', 'dynamic (per request)')} />
}
