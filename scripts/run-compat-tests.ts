// Usage:  npm run test:compat -- --url https://deployed-site.example [options]
// Secrets come from the environment only (never flags, so they stay out of shell history):
//   REVALIDATE_TOKEN   enables the on-demand revalidation success path
//   SERVER_ONLY_PROBE  enables the server-only variable leak scan
import { createInterface } from 'node:readline/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { errorMessage, makeHttp, makeRedactor, sleep } from './compat/lib.ts'
import type { Ctx, Outcome, TestDef } from './compat/lib.ts'
import { renderTests } from './compat/tests-render.ts'
import { serverTests } from './compat/tests-server.ts'
import { platformTests } from './compat/tests-platform.ts'
import { cacheComponentTests } from './compat/tests-cache-components.ts'
import { printConsole, summarize, writeReports } from './compat/report.ts'
import type { Report, TestRecord } from './compat/report.ts'

const HELP = `
npm run test:compat -- --url <https://site> [options]

  --url <url>            deployment to test (required; only this origin is contacted)
  --host <label>         label for reports, [a-z0-9.-] (default: derived from the URL hostname)
  --mode <server|export> server (default) or export (static-export expectations)
  --variant <main|cache-components>   which app is deployed at the URL (default: main)
  --fast                 skip the ~35s ISR window wait
  --long-seconds <list>  durations for the long-running probe, e.g. 5,15,30,60 (default: 5)
  --body-sizes <list>    payload sizes in KiB for the body-size probe (default: 64,1024,4096,6144)
  --only <ids>           comma-separated test ids to run
  --expect-fail <ids>    test ids whose FAIL is expected here (reported, but exit code stays 0)
  --yes                  skip the confirmation prompt for non-localhost targets
  --list                 print test ids and exit
`

const csvNumbers = (min: number, max: number) =>
  z
    .string()
    .transform((s) => s.split(',').map((x) => Number(x.trim())))
    .pipe(z.array(z.number().int().min(min).max(max)).min(1).max(10))

const optionsSchema = z.object({
  url: z.url().refine((u) => /^https?:$/.test(new URL(u).protocol), 'url must be http(s)'),
  host: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{0,62}$/, 'host label must match [a-z0-9.-]')
    .optional(),
  mode: z.enum(['server', 'export']).default('server'),
  variant: z.enum(['main', 'cache-components']).default('main'),
  fast: z.boolean().default(false),
  'long-seconds': csvNumbers(1, 60).default([5]),
  'body-sizes': csvNumbers(1, 20_480).default([64, 1024, 4096, 6144]),
  only: z.string().optional(),
  'expect-fail': z.string().optional(),
  yes: z.boolean().default(false),
  list: z.boolean().default(false),
})

function isLocal(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
}

async function confirm(target: URL): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error(
      `Refusing to test non-local target ${target.origin} non-interactively. Pass --yes to confirm.`,
    )
    return false
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`Run the compatibility suite against ${target.origin}? (y/N) `)
  rl.close()
  return /^y(es)?$/i.test(answer.trim())
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      host: { type: 'string' },
      mode: { type: 'string' },
      variant: { type: 'string' },
      fast: { type: 'boolean' },
      'long-seconds': { type: 'string' },
      'body-sizes': { type: 'string' },
      only: { type: 'string' },
      'expect-fail': { type: 'string' },
      yes: { type: 'boolean' },
      list: { type: 'boolean' },
      help: { type: 'boolean' },
    },
    strict: true,
  })

  const all: TestDef[] = [...renderTests, ...serverTests, ...platformTests, ...cacheComponentTests]
  if (values.list) {
    for (const t of all) console.log(`${t.feature.padStart(2)}  ${t.id}`)
    return 0
  }
  if (values.help || !values.url) {
    console.log(HELP)
    return values.help ? 0 : 2
  }

  const parsed = optionsSchema.safeParse(values)
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      console.error(`Invalid --${issue.path.join('.')}: ${issue.message}`)
    return 2
  }
  const opts = parsed.data
  const target = new URL(opts.url)
  const base = new URL(target.origin)

  if (!isLocal(base.hostname)) {
    if (base.protocol !== 'https:')
      console.warn(
        'Warning: target is not HTTPS; Secure cookies and HSTS cannot be verified meaningfully.',
      )
    if (!opts.yes && !(await confirm(base))) {
      console.error('Aborted.')
      return 2
    }
  }

  const secrets = {
    revalidateToken: process.env.REVALIDATE_TOKEN || undefined,
    serverProbe: process.env.SERVER_ONLY_PROBE || undefined,
  }
  const redact = makeRedactor(secrets)
  const hostLabel =
    opts.host ??
    base.hostname
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, '-')
      .replace(/^-+/, '') ??
    'target'
  const ctx: Ctx = {
    http: makeHttp(base),
    mode: opts.mode,
    variant: opts.variant,
    fast: opts.fast,
    longSeconds: opts['long-seconds'],
    bodySizes: opts['body-sizes'].map((kib) => kib * 1024),
    secrets,
    sleep,
  }

  // The cache-components app only has its own page; other tests would just 404 there.
  const variantIds = new Set(['cache-components', 'security-headers'])
  const only = opts.only ? new Set(opts.only.split(',').map((s) => s.trim())) : undefined
  const expectFail = new Set(
    (opts['expect-fail'] ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  )
  const selected = all.filter(
    (t) => (!only || only.has(t.id)) && (opts.variant === 'main' || variantIds.has(t.id)),
  )
  const startedAt = new Date()
  const results: TestRecord[] = []
  for (const test of selected) {
    const started = Date.now()
    let outcome: Outcome
    if (process.stdout.isTTY) process.stdout.write(`  running ${test.id}…\r`)
    try {
      outcome = await test.run(ctx)
    } catch (error) {
      outcome = { status: 'FAIL', reason: `unexpected error: ${errorMessage(error)}` }
    }
    const expected = outcome.status === 'FAIL' && expectFail.has(test.id)
    results.push({
      id: test.id,
      expected,
      feature: test.feature,
      name: test.name,
      status: outcome.status,
      reason: redact(expected ? `[expected in this setup] ${outcome.reason}` : outcome.reason),
      durationMs: Date.now() - started,
    })
  }

  const report: Report = {
    host: hostLabel,
    target: base.origin,
    mode: opts.mode,
    variant: opts.variant,
    date: startedAt.toISOString().slice(0, 10),
    startedAt: startedAt.toISOString(),
    runnerNode: process.version,
    summary: summarize(results),
    results,
  }
  printConsole(report)
  const files = writeReports(report, resolve(import.meta.dirname, '..', 'reports'), redact)
  console.log(`  reports: ${files.map((f) => f.replace(process.cwd() + '/', '')).join(', ')}\n`)
  return results.some((r) => r.status === 'FAIL' && !r.expected) ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`runner error: ${errorMessage(error)}`)
    process.exit(2)
  },
)
