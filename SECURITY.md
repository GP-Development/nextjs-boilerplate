# Security log

A running record of every security decision. Each entry: **threat**, **mitigation**,
**where it lives**, **how to verify**. Newest sections are appended as features are built.

## S1. Dependency supply chain

- **Threat:** malicious or vulnerable packages; lifecycle scripts (`postinstall`) executing on install.
- **Mitigation:** exact versions (no `^`/`~`), committed `package-lock.json`, `.npmrc` sets
  `ignore-scripts=true` and `save-exact=true`. Only 4 runtime/framework packages
  (`next`, `react`, `react-dom`, `zod`). No `tsx`, no `husky`, no Tailwind, on purpose.
- **Where:** `package.json`, `.npmrc`.
- **Verify:** `grep -E '"[\^~]' package.json` prints nothing; `npm audit --omit=dev` reports 0.

### Patched against known critical advisories

| Advisory                                                    | Fixed in                                | We use         |
| ----------------------------------------------------------- | --------------------------------------- | -------------- |
| CVE-2025-29927 (middleware authorization bypass via header) | Next.js 15.2.3 and later patch releases | `next@16.3.8`  |
| React Server Components RCE (late 2025, "React2Shell")      | React 19.0.1 / 19.1.2 / 19.2.1 or later | `react@19.3.0` |

Installed versions are newer than every fix release. `npm audit --omit=dev` reports 0 vulnerabilities.

### Documented audit exception (dev-only)

`npm audit` (including dev dependencies) reports 5 _high_ findings, all one root cause:
`braces <=3.0.3` (GHSA-vfj7-8cjw-p6xm, stack-exhaustion DoS from deeply nested glob patterns), reached via
`eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`.

- No patched `braces` release exists (3.0.3 is the latest).
- It is a **dev-only lint toolchain** dependency, absent from production builds and the Docker runtime image.
- Exploitation requires an attacker-controlled glob pattern; ESLint only reads our own config.
- **Decision:** CI gates on `npm audit --omit=dev --audit-level=high` and publishes the full audit as an
  informational step. Revisit when `fast-glob`/`micromatch` ship a fix (Dependabot will propose it).

## S2. Secrets handling

- **Threat:** credentials committed to git or baked into images.
- **Mitigation:** `.env.example` has placeholders only; `.gitignore` ignores every `.env*` except the
  example; `scripts/secret-scan.mjs` runs in `.githooks/pre-commit` (plus gitleaks if installed) and
  reports file/line/rule only, never the matched text. CI re-runs the scan, because `git commit --no-verify`
  bypasses local hooks.
- **Where:** `.gitignore`, `.env.example`, `scripts/secret-scan.mjs`, `.githooks/pre-commit`.
- **Verify:** stage a fake key or a `.env.local`, then run `node scripts/secret-scan.mjs`; it exits 1.

## S3. Environment validation

- **Threat:** misconfiguration (missing or weak token) discovered late; secrets leaking through error messages.
- **Mitigation:** all variables parsed with zod in one module; server start calls it (fail fast); errors list
  variable **names and failure kind only**, never values. `REVALIDATE_TOKEN` must be at least 32 characters.
- **Where:** `src/env.ts`, `src/instrumentation.ts` (exits with code 1 on invalid config).
- **Verify:** start the server with `REVALIDATE_TOKEN=short`; startup fails and the output does not contain `short`.

## S4. Security headers and CSP (Decision B)

- **Threat:** XSS, clickjacking, MIME sniffing, protocol downgrade, referrer/feature leakage.
- **Mitigation:** every route gets HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, `X-Frame-Options: DENY`, COOP, and a CSP containing `frame-ancestors 'none'`,
  `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. `X-Powered-By` is disabled.
  - **Dynamic pages** (`NONCE_ROUTES`): `src/proxy.ts` mints a fresh nonce per request and sets
    `script-src 'self' 'nonce-…' 'strict-dynamic'` (no `unsafe-inline`).
  - **Static/ISR pages:** `script-src 'self' 'unsafe-inline'`. **Trade-off:** a nonce must be created per request
    and injected at render time, but static HTML exists before any request, so a nonce policy would block its own
    scripts, and forcing dynamic rendering would destroy the SSG/ISR tests. Next.js's hash-based alternative
    (`experimental.sri`) is marked experimental in the bundled docs, so it is not used for a security control.
    Remote script loading, framing and plugins are still blocked on these pages.
  - **API routes:** `default-src 'none'; frame-ancestors 'none'`.
  - `upgrade-insecure-requests` is omitted: it breaks plain-HTTP localhost runs. HSTS covers HTTPS hosts.
- **Where:** `src/lib/security-headers.ts`, `next.config.ts` (`headers()`), `src/proxy.ts`.
- **Verify:** `curl -sI <url>/` shows all headers; the compat runner checks them on every host (hosts
  sometimes strip or override headers). Dynamic pages show a `nonce-` in `script-src`.

## S5. Proxy is not an authorization boundary

- **Threat:** CVE-2025-29927 allowed skipping middleware with a crafted `x-middleware-subrequest` header; any
  auth enforced only there was bypassable. Proxy can also be deployed to a CDN and run outside the app.
- **Mitigation:** proxy only adds headers, rewrites and redirects. Protected endpoints verify credentials
  themselves in the route handler. Patched Next.js is used (S1).
- **Where:** comment in `src/proxy.ts`; `src/app/api/tests/revalidate/route.ts` (added later).
- **Verify:** the runner sends `x-middleware-subrequest` and confirms behavior is unchanged.

## S6. Request-derived values and SSRF

- **Threat:** the fetch-cache test makes a server-side request to this app's own route handler. Building that URL from
  the incoming `Host` header would let an attacker point the server at arbitrary hosts (SSRF / host-header injection).
- **Mitigation:** the origin comes only from validated config (`SELF_ORIGIN`, a zod `url`) with a fixed localhost
  fallback. Failures return a generic marker string, with no URL or stack trace in the output.
- **Where:** `src/app/tests/fetch-cache/page.tsx`, `src/env.ts`.
- **Verify:** send `Host: evil.example`; the page still reports values from the trusted origin.

## S7. Route params

- **Threat:** untrusted path segments reaching rendering logic.
- **Mitigation:** the `[slug]` param is parsed with a zod enum allowlist; anything else calls `notFound()` and returns a real 404.
- **Where:** `src/app/tests/dynamic-routes/[slug]/page.tsx`.
- **Verify:** `curl -o /dev/null -w '%{http_code}' <url>/tests/dynamic-routes/nope` prints 404.

## S8. Revalidation endpoint

- **Threat:** anyone able to purge caches (cost, cache-busting DoS); token theft via logs/URLs; timing attacks.
- **Mitigation:** POST only (other methods get 405); token read from the `x-revalidate-token` header, never
  the query string; compared with `crypto.timingSafeEqual` over SHA-256 digests (equal length, so the secret's
  length does not leak); generic 401 with `Cache-Control: no-store`; nothing is logged; no body is read.
  The token must be at least 32 characters (S3). The endpoint verifies credentials itself and does not depend on `proxy.ts` (S5).
- **Where:** `src/app/api/tests/revalidate/route.ts`, `src/lib/constant-time.ts`.
- **Verify:** GET returns 405; a missing, wrong or query-string token returns 401; the correct header returns 200.
  The runner checks all four without printing the token.

## S9. Server Action

- **Threat:** CSRF against actions, unvalidated input, XSS through echoed input.
- **Mitigation:** Next.js compares the `Origin` header to the host and aborts mismatches (verified: a forged
  `Origin: https://evil.example` is rejected). Input is parsed with zod (trimmed, 1-100 chars); failures return a
  generic "Invalid input". The echo is rendered as React text, so it is HTML-escaped. There is no storage or side effect.
- **Known caveat:** a request carrying **no** `Origin` header is allowed through with a warning (per the Next.js docs).
  Hosts that rewrite `Host`/`x-forwarded-host` may need `experimental.serverActions.allowedOrigins`.
- **Where:** `src/app/tests/server-action/`.
- **Verify:** the runner replays the form with a forged Origin and expects a non-2xx response.

## S10. Opt-in stress endpoints (abuse surface)

- **Threat:** `/api/tests/long-running` and `/api/tests/body-size` let anyone tie up workers or bandwidth on a public deployment.
- **Mitigation:** both answer 404 unless `ENABLE_STRESS_TESTS=true` (default `false`, validated by zod in `src/env.ts`).
  When enabled: `seconds` is a zod-validated integer 1-60; at most 5 concurrent long-running requests per instance
  (429 beyond that; best effort, since there is no shared state across instances); abandoned requests free their slot
  via `request.signal`; body size is capped at 8 MiB and counted while streaming, so an oversized upload is cut off
  rather than buffered, including chunked uploads that send no `Content-Length`.
- **Operational advice:** enable only for the duration of a measurement run, then remove the variable.
- **Where:** `src/lib/stress-guard.ts`, `src/lib/body.ts`, `src/app/api/tests/{long-running,body-size}/route.ts`.
- **Verify:** without the flag both return 404; with it, `seconds=61` returns 400 and a 9 MB body returns 413.

## S11. Proxy body buffering

- **Threat:** when a route is matched by `proxy.ts`, Next.js clones and buffers the request body in memory (default
  cap 10 MB) and silently truncates beyond it. That is a memory-amplification risk and would corrupt the body-size measurement.
- **Mitigation:** `/api/tests/body-size` is excluded from the proxy matcher, and the endpoint enforces its own streaming cap.
- **Where:** `matcher` in `src/proxy.ts`.
- **Verify:** `curl -sI -X POST <url>/api/tests/body-size` has no `x-compat-proxy` header (other routes do).

## S12. JSON route handler input

- **Threat:** malformed, oversized or unexpected input.
- **Mitigation:** content type must be `application/json` (415); body capped at 4 KiB (413); parsed with a `.strict()`
  zod object (unknown keys rejected); all failures return `{"error":"invalid request"}` with no detail.
- **Where:** `src/app/api/tests/node-route/route.ts`.
- **Verify:** the runner posts valid, empty-name, extra-key, non-JSON and wrong-content-type bodies.

## S13. Cookies, rewrite and redirect

- **Threat:** cookie theft or leakage (XSS, plain HTTP, cross-site sends); open redirects.
- **Mitigation:** the test cookie is `HttpOnly; Secure; SameSite=Lax; Path=/` with a 10-minute lifetime, a random value,
  and no sensitive content. Redirect and rewrite destinations are hard-coded constants, never derived from input.
- **Where:** `src/app/api/tests/cookies/route.ts`, `src/proxy.ts`.
- **Verify:** `curl -si -X POST <url>/api/tests/cookies | grep -i set-cookie` shows all three flags.
  `Secure` cookies are not stored by browsers over plain HTTP (except localhost); the runner replays the `Cookie` header itself.

## S14. Image optimizer

- **Threat:** the optimizer fetches and transforms images, which makes it an SSRF vector and a CPU/cost-abuse surface if it accepts arbitrary URLs, sizes or qualities.
- **Mitigation:** `images.remotePatterns: []` (no remote hosts), `localPatterns` limited to `/test-image.png`,
  `qualities: [75]`, `formats: ['image/webp']`. SVG stays disallowed (the default).
- **Where:** `next.config.ts`, `src/app/tests/image/page.tsx`.
- **Verify:** `/_next/image?url=https://example.com/x.png&w=640&q=75`, an off-list width (641), an off-list quality (50)
  and another local path each return 400. The runner checks all four.

## S15. Environment variable exposure

- **Threat:** a server-only secret compiled into client JavaScript, or printed.
- **Mitigation:** server-only values are read through `src/lib/server-secrets.ts`, which imports `server-only` (a build error if a
  Client Component imports it). The env page shows only present/absent plus the first 12 hex chars of a SHA-256. For a high-entropy
  value the hash reveals nothing useful; do **not** use a guessable value for `SERVER_ONLY_PROBE`.
- **Where:** `src/lib/server-secrets.ts`, `src/app/tests/env/`.
- **Verify:** the runner (given the probe value in its own environment) confirms the value is absent from the page HTML and every
  client chunk the page loads, and that the `NEXT_PUBLIC_` label is present in the client bundle. Result output never contains the value.

## S16. Diagnostics page allowlist

- **Threat:** information disclosure, since dumping `process.env` leaks secrets and platform internals.
- **Mitigation:** an explicit allowlist: Node version, runtime, Next.js version, build id, platform/arch, `NODE_ENV`, and a host label
  derived by testing whether specific marker variable **names** exist (`src/lib/host-detect.ts`). Values of those markers are never read into output.
- **Where:** `src/app/tests/diagnostics/page.tsx`, `src/lib/host-detect.ts`.
- **Verify:** the runner asserts that the diagnostics body contains none of the substrings `PATH=`, `HOME=`, `SECRET`, `PASSWORD`, nor the runner's own secret values.
  The page is public once deployed; the facts it shows are low sensitivity but are still a fingerprinting aid.

## S17. Error handling

- **Threat:** stack traces and internal messages leaking to users.
- **Mitigation:** `src/app/error.tsx` never renders `error.message`; production Next.js strips server error text; route handlers return generic
  JSON errors. `src/app/tests/error-boundary/page.tsx` throws a canary string on purpose.
- **Verify:** `curl <url>/tests/error-boundary` returns 500 and does not contain `CANARY-7f3a91`. In a browser the boundary UI appears.
  Verified in Chromium with zero CSP violations across every page route (so the nonce policy in S4 works with hydration).

## S18. Test runner safety

- **Threat:** the runner holds a secret (`REVALIDATE_TOKEN`) and sends traffic; it could leak the secret, hit the wrong host, be redirected elsewhere, or be tricked into writing files outside `reports/`.
- **Mitigation:**
  - secrets come only from environment variables (never CLI flags, which land in shell history and process lists);
  - a redactor removes known secret values from every reason string, console line and the serialised JSON/Markdown before output;
  - requests are pinned to the origin passed in `--url` (a request to any other origin throws) and redirects are never followed;
  - non-localhost targets need an interactive confirmation or an explicit `--yes`; non-interactive runs without `--yes` refuse;
  - all CLI input is validated with zod (http/https only; the `--host` label must match `[a-z0-9.-]`, which blocks path traversal in report filenames; numeric lists are bounded);
  - the revalidation test checks a query-string token using a dummy value, never the real token, because URLs are logged by proxies and CDNs;
  - `test:local` generates fresh random secrets per run, never writes them to disk, binds the server to 127.0.0.1, and always stops the server (also on SIGINT/SIGTERM).
- **Where:** `scripts/compat/lib.ts`, `scripts/run-compat-tests.ts`, `scripts/compat/report.ts`, `scripts/test-local.ts`.
- **Verify:** after a run with known secrets, `grep` the `reports/` directory for them (no matches); `--url ftp://x` and `--host ../x` exit 2; a non-local URL without `--yes` and without a TTY exits 2.

## S19. Static export and the static test server

- **Threat:** the export build and local static server could expose files outside `out/` or silently drop security controls.
- **Mitigation:** `scripts/serve-export.mjs` resolves each request path, rejects NUL bytes and bad percent-encoding, and refuses anything that resolves outside `out/`; it serves GET/HEAD only and binds to 127.0.0.1. The export build runs in a gitignored temporary copy so the working tree is never modified. A static export cannot apply `next.config` headers, so the header test is expected to FAIL there (`--expect-fail security-headers`): the failure is still printed and written to the report, marked "expected in this setup", and the real fix is to configure headers at the static host or CDN.
- **Where:** `scripts/serve-export.mjs`, `scripts/build-export.mjs`, `scripts/test-export.mjs`.
- **Verify:** `curl --path-as-is http://127.0.0.1:3200/../package.json` returns 404 (not the file).

## S20. Cache Components variant (second deployable app)

- **Threat:** a second app is a second set of security controls that can silently drift from the main app (missing headers, weaker CSP).
- **Mitigation:** the variant imports the same `src/lib/security-headers.ts` as the main app, so the header set is defined once. Its CSP is the
  documented fallback policy (no nonce) because a Partial-Prerender static shell is created at build time and cannot carry a per-request nonce
  (same trade-off as S4). The runner runs the security-header test against the variant too. No new third-party packages were added (npm workspaces
  only add link entries to the lockfile). `pageExtensions` is limited to `tsx`/`jsx`, which also stops the variant from accidentally compiling the
  main app's `src/proxy.ts` through the shared workspace root.
- **Where:** `variants/cache-components/`, `scripts/compat/tests-cache-components.ts`.
- **Verify:** `npm run test:local:cache-components` passes the `security-headers` and `cache-components` tests.

## S21. Docker image

- **Threat:** a mutable base tag changing underneath us; secrets baked into layers; root inside the container; build tooling shipped to production; a writable filesystem for an attacker to persist in.
- **Mitigation:** base image pinned by digest (`node:22-alpine@sha256:0a7108bf...`); multi-stage build (dev dependencies and sources stay in the build stage; the runtime image holds only the standalone output, 86 MB);
  `npm ci --ignore-scripts` from the lockfile; runs as the unprivileged `node` user (uid 1000) and `/app` is root-owned and not writable; no secrets at build time (the only build arg is the public `NEXT_PUBLIC_BUILD_LABEL`);
  `.dockerignore` excludes `.env*`, `.git`, `node_modules`, reports and scripts. An optional **build secret** (`--secret id=extra_ca`) supports TLS-inspecting corporate proxies: it is mounted for one command only and is never stored in a layer.
  `npm run test:docker` runs the container with `--read-only`, `--cap-drop ALL` and `no-new-privileges`, with only the Next.js cache directory as a tmpfs; secrets are passed as `-e NAME` (no value on the command line, so not visible in `ps`).
- **Where:** `Dockerfile`, `.dockerignore`, `scripts/test-docker.ts`.
- **Verify:** `docker image inspect nextjs-compat-test:main --format '{{.Config.User}}'` prints `node`; `docker history --no-trunc <image> | grep -i token` finds nothing;
  `docker run --rm --entrypoint sh <image> -c 'touch /app/x'` is denied; `npm run test:docker` passes.
- **Known gap:** the digest is pinned manually; Dependabot (S23) proposes updates, but a human must review them.

## S22. CI (GitHub Actions)

- **Threat:** a malicious PR (especially from a fork) exfiltrating secrets or tampering with the repo; a compromised or retagged third-party action; poisoned build caches.
- **Mitigation:** trigger is `pull_request` (never `pull_request_target`); the workflow references **no secrets**; top-level `permissions: contents: read`; `persist-credentials: false` on checkout;
  `actions/checkout` and `actions/setup-node` pinned to full commit SHAs (release noted in a comment); no dependency cache; `npm ci --ignore-scripts`; the secret scan re-runs over all tracked files (because `--no-verify` bypasses the local hook);
  production audit gates the build (`npm audit --omit=dev --audit-level=high`), the full audit is informational (see the dev-only exception in S1).
- **Where:** `.github/workflows/ci.yml`.
- **Verify:** `grep -n 'secrets\.\|pull_request_target' .github/workflows/ci.yml` finds no use; every `uses:` line has a 40-character SHA.
- **Known gap:** the repository's branch protection (required reviews and status checks) and the "Require approval for outside collaborators" Actions setting are GitHub settings that cannot be committed; configure them in the repository settings.

## S23. Dependabot

- **Threat:** silently drifting onto vulnerable versions of Next.js, React, actions or the base image.
- **Mitigation:** weekly update PRs for npm (root and workspace), GitHub Actions (keeps the pinned SHAs current) and Docker (base image digest). Next.js/React packages are grouped so they move together.
- **Where:** `.github/dependabot.yml`.
- **Verify:** the Dependabot tab in the repository's Insights shows the three ecosystems.

## Out of scope / known limitations

These are real gaps, listed so nobody assumes they are covered.

- **No rate limiting.** It does not work the same way across hosts (shared state, serverless instances, CDNs), so it is deliberately not simulated here. The abusable endpoints are opt-in instead (S10), and the concurrency cap is per instance only. If you leave a deployment public, use the host's WAF or rate-limit feature.
- **No authentication or authorization system.** The one protected endpoint uses a single shared static token (S8). There is no rotation, expiry, per-caller identity or audit log. Treat the token as disposable: rotate it after a test campaign.
- **Weaker CSP on build-time pages.** Static, ISR and prerendered shells use `'unsafe-inline'` for scripts and styles (S4, S20). An XSS bug in those pages would not be stopped by CSP. There is currently no user-controlled output on them, but this is a trade-off, not a guarantee. Next.js's hash-based option is experimental and was not used.
- **No CSP reporting, HSTS preload or `Cross-Origin-Embedder-Policy`.** Headers are a baseline, not a full hardening profile. HSTS is sent on every response, but a plain-HTTP localhost run cannot exercise it.
- **Server Actions without an `Origin` header** are allowed through with a warning by Next.js (S9). Hosts that rewrite `Host` may need `allowedOrigins`.
- **Public diagnostics page.** It shows only allowlisted facts (S16), but Node/Next versions and the host name are a fingerprinting aid. Remove or protect the page on a long-lived deployment.
- **Host-level logging.** Many hosts log request headers or bodies. The revalidation token travels in a header (not the URL), but you should assume a host operator or log drain can see it. Rotate after testing.
- **HTTPS is the host's job.** The runner warns when the target is not HTTPS; nothing here terminates TLS.
- **Pre-commit scanning is best-effort.** The hook is dependency-free pattern matching (plus gitleaks if installed) and can be bypassed with `--no-verify`; CI re-scans tracked files but not git history. Run `gitleaks detect` over history before making the repository public.
- **Dev-only audit exception** (`braces`, S1) stays open until a patched release exists.
- **Manual review of automated updates.** Dependabot proposes updates to dependencies, action SHAs and the image digest, but nothing here verifies them automatically; read the diff.
- **GitHub settings are not code.** Branch protection, required reviews and the "approve outside collaborators' workflows" option (S22) must be configured in the repository settings.
- **Managed-host deployments were not exercised.** Only local, Docker and static-export runs were verified (see README).
- **Edge runtime** is deprecated in Next.js 16; test 10 may start failing or reporting PARTIAL on future versions.
- **TypeScript 7 and ESLint 10** were not adopted because the lint toolchain does not yet support them; revisit after dependency updates.

## How to re-verify the security controls

```bash
npm audit --omit=dev --audit-level=high      # S1  production dependencies
node scripts/secret-scan.mjs --all           # S2  tracked files
npm run test:local                           # S3-S20 headers, auth, validation, leaks, caps (21 checks)
npm run test:docker                          # S21 the container, hardened flags
grep -rn "secrets\.\|pull_request_target" .github/workflows   # S22 should show no usage
```
