import { connection } from 'next/server'
import { MessageForm } from './MessageForm'

export default async function ServerActionPage() {
  // Rendered per request so the proxy's per-request CSP nonce can be applied (SECURITY.md S4).
  await connection()
  return (
    <section data-testid="result" data-feature="server-action">
      <h1>server-action</h1>
      <p>
        render mode: <strong data-testid="render-mode">dynamic + server action</strong>
      </p>
      <MessageForm />
    </section>
  )
}
