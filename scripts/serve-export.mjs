#!/usr/bin/env node
// Minimal static file server for verifying `out/` locally (no dependency). It stands in for
// a plain static host: it adds NO security headers, which the runner will report.
//   node scripts/serve-export.mjs [port]      (binds to 127.0.0.1 only)
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..', 'out')
const port = Number(process.argv[2] ?? 3200)
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
}

async function resolveFile(pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const target = resolve(join(root, decoded))
  // Path traversal guard: the resolved path must stay inside out/.
  if (target !== root && !target.startsWith(root + sep)) return null
  for (const candidate of [target, `${target}.html`, join(target, 'index.html')]) {
    const info = await stat(candidate).catch(() => null)
    if (info?.isFile()) return candidate
  }
  return null
}

createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  const file = await resolveFile(pathname)
  const notFound = file === null
  const body = await readFile(notFound ? join(root, '404.html') : file).catch(() =>
    Buffer.from('Not found'),
  )
  res.writeHead(notFound ? 404 : 200, {
    'Content-Type': TYPES[extname(notFound ? '.html' : file)] ?? 'application/octet-stream',
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}).listen(port, '127.0.0.1', () => console.log(`serving out/ on http://127.0.0.1:${port}`))
