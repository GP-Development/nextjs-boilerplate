// Helpers shared by test-local.ts and test-docker.ts.
import { createServer } from 'node:net'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { sleep } from './lib.ts'

/** Fresh random secrets per run. They live only in memory and in child-process environments. */
export function makeRunSecrets() {
  return {
    revalidateToken: randomBytes(24).toString('hex'),
    serverProbe: `probe-${randomBytes(12).toString('hex')}`,
    label: `compat-${randomBytes(4).toString('hex')}`,
  }
}

export async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  server.close()
  await once(server, 'close')
  return port
}

export async function waitUntilReady(
  url: string,
  isAlive: () => boolean,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error('server exited before becoming ready')
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
