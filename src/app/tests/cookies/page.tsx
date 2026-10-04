import { cookies } from 'next/headers'
import { ResultBlock } from '@/components/ResultBlock'
import { makeResult } from '@/lib/result'

// Reads the test cookie during server rendering. Set it first with POST /api/tests/cookies.
export default async function CookiesPage() {
  const present = (await cookies()).has('compat_test')
  return (
    <ResultBlock
      result={makeResult('cookies-page', 'dynamic (cookies())', { cookiePresent: present })}
    />
  )
}
