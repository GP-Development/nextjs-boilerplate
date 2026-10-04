# Host comparison

Fill one column per host from `reports/<host>-<date>.md` (or paste the generated table). Use PASS / PARTIAL / FAIL / SKIPPED
and put the one-line reason or measured limit in the cell. Record the date and Next.js version at the top.

- Date: ________ Next.js: 16.3.8 Runner version / commit: ________
- Env on every host: `REVALIDATE_TOKEN`, `SERVER_ONLY_PROBE`, `SELF_ORIGIN`, `ENABLE_STRESS_TESTS=true` (only while measuring)

| #   | Test                            | Vercel | Netlify | Cloudflare | AWS Amplify | Render | Railway | Fly.io | Docker / VPS |
| --- | ------------------------------- | ------ | ------- | ---------- | ----------- | ------ | ------- | ------ | ------------ |
| 1   | Static (SSG)                    |        |         |            |             |        |         |        |              |
| 2   | Dynamic (SSR)                   |        |         |            |             |        |         |        |              |
| 3   | ISR, 30 s                       |        |         |            |             |        |         |        |              |
| 4   | On-demand revalidation          |        |         |            |             |        |         |        |              |
| 5   | Dynamic routes + 404            |        |         |            |             |        |         |        |              |
| 6   | Streaming + Suspense            |        |         |            |             |        |         |        |              |
| 7   | Fetch caching                   |        |         |            |             |        |         |        |              |
| 8   | Cache Components / PPR          |        |         |            |             |        |         |        |              |
| 9   | Route handler (Node)            |        |         |            |             |        |         |        |              |
| 10  | Route handler (Edge)            |        |         |            |             |        |         |        |              |
| 11  | Server Action                   |        |         |            |             |        |         |        |              |
| 12  | Proxy (header/rewrite/redirect) |        |         |            |             |        |         |        |              |
| 13  | Cookies                         |        |         |            |             |        |         |        |              |
| 14  | Long-running (max seconds ok)   |        |         |            |             |        |         |        |              |
| 15  | Body size (max accepted)        |        |         |            |             |        |         |        |              |
| 16  | next/image                      |        |         |            |             |        |         |        |              |
| 17  | next/font                       |        |         |            |             |        |         |        |              |
| 18  | Config redirects/rewrites/hdrs  |        |         |            |             |        |         |        |              |
| 19  | Environment variables           |        |         |            |             |        |         |        |              |
| 20  | Error pages                     |        |         |            |             |        |         |        |              |
| 21  | Diagnostics (detected host)     |        |         |            |             |        |         |        |              |
| S   | Security headers                |        |         |            |             |        |         |        |              |
|     | **Totals** (PASS/PARTIAL/FAIL)  |        |         |            |             |        |         |        |              |
