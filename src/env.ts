import { z } from 'zod'

// Single place where environment variables are parsed. Everything else imports
// from here instead of touching process.env, so every variable is validated.
const schema = z.object({
  REVALIDATE_TOKEN: z.string().min(32),
  ENABLE_STRESS_TESTS: z.enum(['true', 'false']).default('false'),
  SERVER_ONLY_PROBE: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Trusted origin this app uses to call its OWN route handlers (fetch-cache test).
  // Never derived from the request Host header (that would be SSRF-able).
  SELF_ORIGIN: z.url().optional(),
  NEXT_PUBLIC_BUILD_LABEL: z.string().max(64).default('unset'),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

export function getEnv(): Env {
  if (cached) return cached
  const result = schema.safeParse(process.env)
  if (!result.success) {
    // Security: report variable NAMES and the failure kind only. Never echo
    // values, because a mistyped secret is still a secret.
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
      .join(', ')
    throw new Error(`Invalid environment configuration -> ${problems}. See .env.example.`)
  }
  cached = result.data
  return cached
}
