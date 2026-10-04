import { notFound } from 'next/navigation'
import { z } from 'zod'
import { ResultBlock } from '@/components/ResultBlock'
import { makeResult } from '@/lib/result'

// Allowlist: alpha and beta are prebuilt; gamma is valid but only generated on first request.
// Any other value is "unknown" and must return a real 404.
const slugSchema = z.enum(['alpha', 'beta', 'gamma'])
const PREBUILT = ['alpha', 'beta'] as const

export function generateStaticParams() {
  return PREBUILT.map((slug) => ({ slug }))
}

export default async function DynamicRoutePage({ params }: { params: Promise<{ slug: string }> }) {
  const parsed = slugSchema.safeParse((await params).slug)
  if (!parsed.success) notFound()
  const slug = parsed.data
  return (
    <ResultBlock
      result={makeResult('dynamic-routes', 'static params', {
        slug,
        prebuilt: (PREBUILT as readonly string[]).includes(slug),
      })}
    />
  )
}
