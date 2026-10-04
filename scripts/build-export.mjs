#!/usr/bin/env node
// Static export build (test 23).  `output: "export"` cannot contain anything that needs a
// server, and Next.js fails the whole build if such a route exists. So this script builds
// a TEMPORARY COPY of the project with the incompatible routes removed, then copies only
// `out/` back. Your working tree is never modified.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
// Inside the repo (gitignored) because Turbopack rejects node_modules symlinks that point outside its root.
const work = join(root, '.export-build')
rmSync(work, { recursive: true, force: true })
mkdirSync(work)

// Routes that rely on a server: route handlers, per-request rendering, Server Actions,
// cookies/env/headers at runtime, intentional runtime errors. Documented in TESTS.md.
const REMOVE = [
  'src/app/api',
  'src/app/tests/dynamic',
  'src/app/tests/streaming',
  'src/app/tests/fetch-cache',
  'src/app/tests/server-action',
  'src/app/tests/cookies',
  'src/app/tests/env',
  'src/app/tests/error-boundary',
  'src/app/tests/diagnostics',
  'src/proxy.ts', // proxy needs a server
  'src/instrumentation.ts',
]

try {
  // Whitelist exactly what `next build` needs (also avoids copying a dir into itself).
  for (const entry of [
    'src',
    'public',
    'next.config.ts',
    'tsconfig.json',
    'package.json',
    'package-lock.json',
    '.npmrc',
  ]) {
    cpSync(join(root, entry), join(work, entry), { recursive: true })
  }
  // Hard-link node_modules (instant, no extra disk). Fall back to a real copy if unsupported.
  const link = spawnSync('cp', ['-al', join(root, 'node_modules'), join(work, 'node_modules')])
  if (link.status !== 0)
    cpSync(join(root, 'node_modules'), join(work, 'node_modules'), { recursive: true })
  for (const rel of REMOVE) rmSync(join(work, rel), { recursive: true, force: true })

  // Unknown params cannot be generated on demand without a server -> only prebuilt paths exist.
  const page = join(work, 'src/app/tests/dynamic-routes/[slug]/page.tsx')
  writeFileSync(
    page,
    readFileSync(page, 'utf8').replace(
      'export function generateStaticParams',
      'export const dynamicParams = false\n\nexport function generateStaticParams',
    ),
  )

  const result = spawnSync(
    process.execPath,
    [join(work, 'node_modules/next/dist/bin/next'), 'build'],
    {
      cwd: work,
      stdio: 'inherit',
      env: { ...process.env, BUILD_OUTPUT: 'export' },
    },
  )
  if (result.status !== 0) process.exit(result.status ?? 1)

  rmSync(join(root, 'out'), { recursive: true, force: true })
  if (!existsSync(join(work, 'out'))) throw new Error('export produced no out/ directory')
  cpSync(join(work, 'out'), join(root, 'out'), { recursive: true })
  console.log('Static export written to out/')
} finally {
  rmSync(work, { recursive: true, force: true })
}
