#!/usr/bin/env node
// npm run test:export : build the static export, serve out/ locally, run the suite in export mode.
import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
const port = 3200

const build = spawnSync(process.execPath, [resolve(root, 'scripts/build-export.mjs')], {
  stdio: 'inherit',
})
if (build.status !== 0) process.exit(build.status ?? 1)

const server = spawn(process.execPath, [resolve(root, 'scripts/serve-export.mjs'), String(port)], {
  stdio: 'ignore',
})
try {
  await delay(800)
  const runner = spawnSync(
    process.execPath,
    [
      resolve(root, 'scripts/run-compat-tests.ts'),
      '--url',
      `http://127.0.0.1:${port}`,
      '--host',
      'local-export',
      '--mode',
      'export',
      // Our tiny static server (like any plain file host) sends no security headers; the
      // runner still reports that as FAIL, but it does not fail this script. See TESTS.md.
      '--expect-fail',
      'security-headers',
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit' },
  )
  process.exitCode = runner.status ?? 1
} finally {
  server.kill('SIGTERM')
}
