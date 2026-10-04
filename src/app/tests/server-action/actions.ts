'use server'

import { z } from 'zod'

const inputSchema = z.object({
  message: z.string().trim().min(1).max(100),
})

export type ActionState =
  | { status: 'idle' }
  | { status: 'ok'; echo: string; length: number; handledAt: string }
  | { status: 'error'; error: string }

// Validates untrusted form data and echoes it back. No storage, no side effects.
// Next.js also enforces an Origin-vs-Host check on every Server Action call (CSRF defense).
export async function submitMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = inputSchema.safeParse({ message: formData.get('message') })
  if (!parsed.success) {
    return { status: 'error', error: 'Invalid input' } // generic on purpose
  }
  return {
    status: 'ok',
    echo: parsed.data.message,
    length: parsed.data.message.length,
    handledAt: new Date().toISOString(),
  }
}
