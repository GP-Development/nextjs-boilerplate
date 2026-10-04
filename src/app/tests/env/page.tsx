import { connection } from 'next/server'
import { serverOnlyProbe } from '@/lib/server-secrets'
import { PublicLabel } from './PublicLabel'

export default async function EnvPage() {
  await connection() // read runtime env on every request
  const probe = serverOnlyProbe()
  return (
    <section data-testid="result" data-feature="env">
      <h1>env</h1>
      <p>
        render mode: <strong data-testid="render-mode">dynamic</strong>
      </p>
      <ul>
        <li>
          public label (client bundle, inlined at build): <PublicLabel />
        </li>
        <li>
          public label (server read):{' '}
          <span data-testid="public-label-server">{process.env.NEXT_PUBLIC_BUILD_LABEL}</span>
        </li>
        <li>
          server-only probe present:{' '}
          <span data-testid="probe-present">{String(probe.present)}</span>
        </li>
        <li>
          server-only probe sha256 (first 12 hex):{' '}
          <span data-testid="probe-hash">{probe.hash12}</span>
        </li>
      </ul>
    </section>
  )
}
