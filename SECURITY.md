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

## Out of scope / known limitations

(Completed in the final documentation commit.)
