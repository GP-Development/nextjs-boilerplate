import 'server-only' // build fails if a Client Component ever imports this module
import { createHash } from 'node:crypto'
import { getEnv } from '@/env'

// Reports on the server-only probe variable WITHOUT revealing it: present/absent plus a
// truncated SHA-256. For a high-entropy value the hash reveals nothing useful; do not use
// a guessable value for SERVER_ONLY_PROBE.
export function serverOnlyProbe(): { present: boolean; hash12: string } {
  const value = getEnv().SERVER_ONLY_PROBE
  if (!value) return { present: false, hash12: 'n/a' }
  return { present: true, hash12: createHash('sha256').update(value).digest('hex').slice(0, 12) }
}
