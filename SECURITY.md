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
- **Where:** `src/env.ts`, `instrumentation.ts`.
- **Verify:** start the server with `REVALIDATE_TOKEN=short`; startup fails and the output does not contain `short`.

## Out of scope / known limitations

(Completed in the final documentation commit.)
