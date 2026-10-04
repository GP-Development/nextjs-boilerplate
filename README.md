# Next.js hosting compatibility suite

A Next.js 16 project whose only purpose is to test **how well a hosting provider supports Next.js**. Each
feature gets a small, deterministic page or endpoint. A runner hits a deployed URL and writes a pass/fail
report, so you can deploy the same code to several hosts and compare results side by side.

It is not a product: no database, no auth provider, four runtime dependencies (`next`, `react`, `react-dom`, `zod`).

- **What is tested:** [TESTS.md](TESTS.md) (23 features + security headers, with exact pass/fail rules)
- **Security decisions:** [SECURITY.md](SECURITY.md) (threat, mitigation, location, how to verify)
- **Comparison template:** [docs/host-comparison.md](docs/host-comparison.md)

## Requirements

Node **22.18 or newer** (the runner uses Node's built-in TypeScript support, so there is no `tsx`), npm 10+.
Docker is only needed for `npm run test:docker`.

## Quick start

```bash
nvm use                      # or any Node >= 22.18
npm ci                       # exact versions from the lockfile; dependency scripts are disabled (.npmrc)
npm run prepare              # one-time: enables the pre-commit secret scan (git hooks)
cp .env.example .env.local   # then edit; .env* files are git-ignored (except .env.example)
npm run dev
```

Verify everything (the same checks CI runs):

```bash
npm run lint && npm run typecheck && npm run build
npm run test:local           # builds, starts the production server on a free port, runs the suite, stops it (~1 min)
```

| Command                                    | What it does                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `npm run test:local`                       | Build + start + test + clean up. Fresh random secrets every run. Add `-- --fast` to skip the 35 s ISR wait |
| `npm run test:local:cache-components`      | Same, for the Cache Components variant app (test 8)                                                        |
| `npm run test:docker`                      | Builds the image, runs it read-only/non-root/no-capabilities, runs the suite against it                    |
| `npm run test:export`                      | Static export build, served locally, suite in export mode ([expectations](TESTS.md))                       |
| `npm run test:compat -- --url <https://…>` | Run the suite against any deployment (see below)                                                           |
| `npm run build:standalone`                 | `output: "standalone"` build (test 22)                                                                     |
| `npm run build:export`                     | `output: "export"` build into `out/` (test 23)                                                             |

## Environment variables

Validated with zod at server start. Invalid config makes the server exit with a message that names the variable but never its value.

| Variable                  | Required | Purpose                                                                                                                                                            |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `REVALIDATE_TOKEN`        | yes      | Secret (≥ 32 chars) for `POST /api/tests/revalidate`. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`                         |
| `ENABLE_STRESS_TESTS`     | no       | `true` enables the long-running and body-size endpoints. **Default off** (they are abusable on a public host). Turn it on only while measuring                     |
| `SERVER_ONLY_PROBE`       | no       | Any non-empty, high-entropy string. Test 19 shows only whether it is set plus a hash, never the value                                                              |
| `SELF_ORIGIN`             | hosts    | Public URL of this deployment. The fetch-cache page calls its own route handler; never derived from request headers (SSRF). Falls back to `http://127.0.0.1:$PORT` |
| `NEXT_PUBLIC_BUILD_LABEL` | no       | Inlined into the client bundle **at build time** (test 19). Set it in the host's _build_ environment                                                               |
| `PORT`                    | no       | Defaults to 3000                                                                                                                                                   |

Set secrets in the host's dashboard or secret store. Never commit them, never put them in a Dockerfile or `fly.toml`/`netlify.toml`.

## Running the suite against a deployment

```bash
export REVALIDATE_TOKEN=...    # same value as on the host (needed for the revalidation success path)
export SERVER_ONLY_PROBE=...   # same value as on the host (enables the secret-leak scan in test 19)
npm run test:compat -- --url https://your-deployment.example --host vercel
```

Secrets are read from the environment only (never flags, which land in shell history) and are redacted from all output and reports.
For any non-localhost URL the runner asks for confirmation (`--yes` to skip; it refuses to run non-interactively without it).
It contacts **only** the origin you pass and never follows redirects.

| Option                       | Meaning                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `--host <label>`             | Name used in report files (`[a-z0-9.-]`); default: the URL's hostname          |
| `--mode server\|export`      | `export` applies static-export expectations                                    |
| `--variant cache-components` | The URL serves `variants/cache-components` (test 8)                            |
| `--fast`                     | Skip the ~35 s ISR window wait (ISR becomes PARTIAL)                           |
| `--long-seconds 5,15,30,60`  | Durations for the timeout probe (needs `ENABLE_STRESS_TESTS=true` on the host) |
| `--body-sizes 64,1024,4096`  | Payload sizes in KiB for the payload-limit probe                               |
| `--only a,b`, `--list`       | Run selected test ids; list ids                                                |

## Reading the reports

Each run writes `reports/<host>-<date>.json` and `reports/<host>-<date>.md` (git-ignored: they contain your deployment URLs).
The `.md` file is a table you can paste into [docs/host-comparison.md](docs/host-comparison.md).

- **PASS**: exactly as expected.
- **PARTIAL**: works but degraded; the reason says how (for example "accepted up to 4 MiB; rejected at 6 MiB" is the host's payload limit,
  and "completed up to 26s; failed at 30s" is its function timeout).
- **FAIL**: wrong behavior. Security failures (a stripped header, a missing cookie flag, a leaked value) are always FAIL.
- **SKIPPED**: not applicable or not enabled; the reason says why (for example stress endpoints disabled).

Exit code is 1 if any test FAILs (except ids listed in `--expect-fail`), so it works in scripts.

## Project layout

```
src/app/tests/<feature>/        page tests            src/app/api/tests/<feature>/   endpoint tests
src/proxy.ts                    proxy (was middleware): CSP nonces, header, rewrite, redirect
src/lib/security-headers.ts     the one definition of the security headers (used by both apps)
src/env.ts                      zod-validated environment      src/instrumentation.ts  fail-fast on bad config
variants/cache-components/      second app for test 8 (npm workspace)
scripts/run-compat-tests.ts     the runner (+ scripts/compat/*)       scripts/test-*.ts   orchestration
Dockerfile  .github/            container build, CI and Dependabot
```

### Why Cache Components is a separate app

`cacheComponents` is a **global** Next.js flag. When on, `runtime = 'edge'` and the classic `revalidate` / `dynamic` / `fetchCache`
segment configs stop working, which would remove tests 3, 7 and 10 from the main app. So test 8 lives in `variants/cache-components`
(an npm workspace sharing one lockfile), and you deploy it separately when you want that test.

## Deploying to each host

> **Honesty note:** the local, Docker and static-export paths below were verified by running them. The managed-host
> sections are **not verified here** (no deployments were made); they list the settings this project needs, taken from
> general platform knowledge. Check each provider's current Next.js documentation, and report what you find in the comparison table.

For every host: set the [environment variables](#environment-variables), set `SELF_ORIGIN` to the host's public URL after the first deploy,
and set `ENABLE_STRESS_TESTS=true` only while running tests 14 and 15. If the host puts an access wall in front of the site
(deployment protection, basic auth), the runner will see 401/403 everywhere; disable it for the test or use the host's bypass mechanism.

- **Vercel**: import the repo, framework preset _Next.js_, defaults for build/output. Function duration is read from `maxDuration` (the long-running route sets 60), but your plan's cap applies. Serverless body limit is about 4.5 MB (test 15 will show it).
- **Netlify**: connect the repo; Netlify's Next.js runtime is applied automatically. Build `npm run build`. Default function timeouts are short (about 10–26 s), so test 14 will show them.
- **Cloudflare**: Next.js on Workers needs the OpenNext Cloudflare adapter (`@opennextjs/cloudflare`) and a Wrangler config with Node compatibility. It adds dependencies, so it is deliberately **not** in this repo: add it on a deployment branch and note in the comparison table that the adapter was used.
- **AWS Amplify Hosting**: connect the repo and let Amplify detect Next.js (SSR). Add env vars in the app settings. If the build image has an older Node, set Node 22 in the build settings.
- **Render**: Web Service, runtime _Node_, build `npm ci --ignore-scripts && npm run build`, start `npm run start`. Render injects `PORT`. Alternatively choose _Docker_ and use the Dockerfile.
- **Railway**: deploy from the repo (build detection) or from the Dockerfile. Start command `npm run start`. Railway injects `PORT`; add variables in the service settings.
- **Fly.io**: `fly launch` (it detects the Dockerfile; internal port 3000), then `fly secrets set REVALIDATE_TOKEN=… SERVER_ONLY_PROBE=…` (never put secrets in `fly.toml`) and `fly deploy`.
- **Docker / VPS** (verified locally):
  ```bash
  docker build --target runner -t nextjs-compat --build-arg NEXT_PUBLIC_BUILD_LABEL=my-label .
  docker run -d -p 127.0.0.1:3000:3000 --read-only --tmpfs /app/.next/cache:uid=1000,gid=1000 --tmpfs /tmp \
    --cap-drop ALL --security-opt no-new-privileges \
    -e REVALIDATE_TOKEN -e SERVER_ONLY_PROBE -e SELF_ORIGIN=http://127.0.0.1:3000 nextjs-compat
  ```
  (`-e NAME` without a value copies it from your shell, so secrets never appear in the command line.) Put a TLS-terminating reverse proxy
  (Caddy, nginx) in front. If it rewrites the `Host` header, add `experimental.serverActions.allowedOrigins` or Server Actions will be refused.
  Behind a TLS-inspecting corporate proxy, see the build-secret note at the top of the `Dockerfile`.

## Dependencies and advisories

Exact versions only (no `^`/`~`), committed `package-lock.json`, dependency install scripts disabled. Installed: Next.js 16.3.8 and React 19.3.0, newer than the
fixes for CVE-2025-29927 (middleware authorization bypass) and the late-2025 React Server Components remote code execution issue.
`npm audit --omit=dev` reports **0** vulnerabilities. The full `npm audit` reports 5 _high_ findings that are one dev-only issue (`braces` via ESLint's config chain,
no patched release exists); it is documented in [SECURITY.md](SECURITY.md) (S1) and does not reach production builds. Dependabot is configured.

## Known limitations

See "Out of scope / known limitations" in [SECURITY.md](SECURITY.md). In short: no rate limiting, a single shared token for the one protected endpoint,
and a weaker (`unsafe-inline`) CSP on build-time pages. Next.js 16 also prints a deprecation notice for the `edge` runtime, which is exactly what test 10 measures.
