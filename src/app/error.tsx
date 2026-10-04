'use client'

// Error boundary for everything under the root layout. It never renders error.message:
// in production Next.js already strips server error text, and we do not echo it either.
export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <main data-testid="error-boundary">
      <h1>Something went wrong</h1>
      <button onClick={() => reset()}>try again</button>
    </main>
  )
}
