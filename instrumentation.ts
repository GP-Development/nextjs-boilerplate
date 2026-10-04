// Runs once when the server starts. Fail fast on bad configuration instead of
// failing on the first request.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getEnv } = await import('./src/env')
    getEnv()
  }
}
