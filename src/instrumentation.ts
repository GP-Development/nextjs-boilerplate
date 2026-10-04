// Runs once when the server starts. Fail fast on bad configuration: log the (value-free)
// reason and exit non-zero, so a misconfigured deploy shows up as a crash, not as a
// half-working server.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getEnv } = await import('./env')
    try {
      getEnv()
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Invalid environment configuration')
      process.exit(1)
    }
  }
}
