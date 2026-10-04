import { z } from 'zod'

// Every test page and endpoint reports in this shape so the runner can decide pass/fail.
export const resultSchema = z.object({
  feature: z.string(),
  renderMode: z.string(),
  timestamp: z.iso.datetime(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
})

export type TestResult = z.infer<typeof resultSchema>

/** Wrapped in a function so "now" is read at render/build time, not module load. */
export function nowIso(): string {
  return new Date().toISOString()
}

export function makeResult(
  feature: string,
  renderMode: string,
  details: TestResult['details'] = {},
  timestamp: string = nowIso(),
): TestResult {
  return resultSchema.parse({ feature, renderMode, timestamp, details })
}
