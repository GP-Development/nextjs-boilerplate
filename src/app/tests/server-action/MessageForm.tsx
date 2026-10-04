'use client'

import { useActionState } from 'react'
import { submitMessage, type ActionState } from './actions'

const initial: ActionState = { status: 'idle' }

export function MessageForm() {
  const [state, formAction, pending] = useActionState(submitMessage, initial)
  return (
    <form action={formAction}>
      <label>
        message (1-100 chars){' '}
        <input name="message" type="text" maxLength={200} required data-testid="message-input" />
      </label>{' '}
      <button type="submit" disabled={pending}>
        send
      </button>
      <p data-testid="action-status">{state.status}</p>
      {state.status === 'ok' && (
        <ul>
          <li>
            echo: <span data-testid="action-echo">{state.echo}</span>
          </li>
          <li>
            length: <span data-testid="action-length">{state.length}</span>
          </li>
          <li>
            handled at: <time data-testid="timestamp">{state.handledAt}</time>
          </li>
        </ul>
      )}
      {state.status === 'error' && <p data-testid="action-error">{state.error}</p>}
    </form>
  )
}
