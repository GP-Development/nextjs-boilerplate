// Explicit allowlist of platform marker variables. We only ever test whether a NAME is set
// and report the host label; values are never read into output, and process.env is never dumped.
const MARKERS: ReadonlyArray<{ host: string; names: readonly string[] }> = [
  { host: 'vercel', names: ['VERCEL', 'VERCEL_ENV'] },
  { host: 'netlify', names: ['NETLIFY', 'NETLIFY_LOCAL'] },
  { host: 'cloudflare', names: ['CF_PAGES', 'CF_WORKER'] },
  { host: 'aws-amplify', names: ['AWS_AMPLIFY_DEPLOYMENT_ID', 'AWS_APP_ID'] },
  { host: 'aws-lambda', names: ['AWS_LAMBDA_FUNCTION_NAME', 'AWS_EXECUTION_ENV'] },
  { host: 'render', names: ['RENDER', 'RENDER_SERVICE_ID'] },
  { host: 'railway', names: ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID'] },
  { host: 'fly.io', names: ['FLY_APP_NAME', 'FLY_REGION'] },
  { host: 'koyeb', names: ['KOYEB_APP_NAME'] },
  { host: 'heroku', names: ['DYNO'] },
  { host: 'digitalocean-app-platform', names: ['APP_PLATFORM'] },
]

export function detectHost(): { host: string; marker: string } {
  for (const { host, names } of MARKERS) {
    for (const name of names) {
      if (process.env[name] !== undefined) return { host, marker: name }
    }
  }
  return { host: 'unknown (self-hosted or unrecognised)', marker: 'none' }
}
