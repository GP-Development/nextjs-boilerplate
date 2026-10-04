// npm run test:local [-- runner options]
// Builds the app, starts the PRODUCTION server on a free localhost port, runs the compat
// suite against it, and always stops the server afterwards.
//
// Security: secrets are generated fresh per run (never written to disk), passed to child
// processes through the environment only, and the server is bound to 127.0.0.1.
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { once } from 'node:events'
import { makeRedactor, sleep } from './compat/lib.ts'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const variantIndex = args.indexOf('--variant')
const variant = variantIndex >= 0 ? args[variantIndex + 1] : 'main'
const appDir = variant === 'cache-components' ? resolve(root, 'variants/cache-components') : root
const nextBin = resolve(root, 'node_modules/next/dist/bin/next')

const secrets = {
  revalidateToken: randomBytes(24).toString('hex'),
  serverProbe: `probe-${randomBytes(12).toString('hex')}`,
}
const redact = makeRedactor(secrets)
const label = `compat-${randomBytes(4).toString('hex')}`

async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  server.close()
  await once(server, 'close')
  return port
}

async function waitUntilReady(url: string, child: ChildProcess, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('server exited before becoming ready')
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'manual' })
      if (res.status < 500) return
    } catch {
      // not listening yet
    }
    await sleep(300)
  }
  throw new Error('server did not become ready in time')
}

async function main(): Promise<number> {
  console.log(`[test:local] building (variant: ${variant})…`)
  const build = spawnSync(process.execPath, [nextBin, 'build'], {
    cwd: appDir,
    stdio: 'inherit',
    // NEXT_PUBLIC_* is inlined at BUILD time, so it must be set here, not only at start.
    env: { ...process.env, NEXT_PUBLIC_BUILD_LABEL: label },
  })
  if (build.status !== 0) return build.status ?? 1

  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const logs: string[] = []
  const server = spawn(
    process.execPath,
    [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'],
    {
      cwd: appDir,
      env: {
        ...process.env,
        PORT: String(port),
        SELF_ORIGIN: url,
        REVALIDATE_TOKEN: secrets.revalidateToken,
        SERVER_ONLY_PROBE: secrets.serverProbe,
        ENABLE_STRESS_TESTS: 'true', // local only: the opt-in flag for the abuse-prone endpoints
        NEXT_PUBLIC_BUILD_LABEL: label,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const collect = (chunk: Buffer) => {
    logs.push(...redact(chunk.toString()).split('\n').filter(Boolean))
    if (logs.length > 200) logs.splice(0, logs.length - 200)
  }
  server.stdout.on('data', collect)
  server.stderr.on('data', collect)
  const stop = () => {
    if (server.exitCode === null) server.kill('SIGTERM')
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      stop()
      process.exit(130)
    })

  try {
    console.log(`[test:local] starting production server on ${url}`)
    await waitUntilReady(url, server)
    const runner = spawnSync(
      process.execPath,
      [
        resolve(root, 'scripts/run-compat-tests.ts'),
        '--url',
        url,
        '--host',
        variant === 'main' ? 'local' : `local-${variant}`,
        ...args,
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          REVALIDATE_TOKEN: secrets.revalidateToken,
          SERVER_ONLY_PROBE: secrets.serverProbe,
        },
      },
    )
    if (runner.status !== 0) {
      console.error('[test:local] server log tail:\n' + logs.slice(-30).join('\n'))
    }
    return runner.status ?? 1
  } catch (error) {
    console.error(`[test:local] ${error instanceof Error ? error.message : 'failed'}`)
    console.error('[test:local] server log tail:\n' + logs.slice(-30).join('\n'))
    return 1
  } finally {
    stop()
  }
}

main().then((code) => process.exit(code))
