import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Constant-time string comparison.
 * timingSafeEqual throws when buffer lengths differ, and an early length check would leak the
 * secret's length. Hashing both sides first gives equal-length digests to compare.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}
