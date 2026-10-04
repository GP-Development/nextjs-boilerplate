import { connection } from 'next/server'

// Throws on purpose (per request) to exercise error.tsx. The runner verifies that the
// canary text below never appears in the response.
export default async function ThrowingPage() {
  await connection()
  throw new Error('intentional test error CANARY-7f3a91')
}
