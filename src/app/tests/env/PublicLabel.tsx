'use client'

// NEXT_PUBLIC_* values are replaced with literals at BUILD time, in client bundles too.
export function PublicLabel() {
  return (
    <span data-testid="public-label-client">{process.env.NEXT_PUBLIC_BUILD_LABEL ?? 'unset'}</span>
  )
}
