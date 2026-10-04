import { connection } from 'next/server'
import nextPackage from 'next/package.json'
import { detectHost } from '@/lib/host-detect'
import { makeResult } from '@/lib/result'
import { ResultBlock } from '@/components/ResultBlock'

// Allowlisted facts only. Never render process.env as a whole.
export default async function DiagnosticsPage() {
  await connection()
  const host = detectHost()
  return (
    <ResultBlock
      result={makeResult('diagnostics', 'dynamic', {
        nodeVersion: process.version,
        runtime: process.env.NEXT_RUNTIME ?? 'unknown',
        nextVersion: nextPackage.version,
        buildId: process.env.COMPAT_BUILD_ID ?? 'unknown',
        detectedHost: host.host,
        hostMarker: host.marker,
        platform: `${process.platform}/${process.arch}`,
        nodeEnv: process.env.NODE_ENV ?? 'unknown',
      })}
    />
  )
}
