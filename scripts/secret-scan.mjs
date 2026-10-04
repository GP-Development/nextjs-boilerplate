#!/usr/bin/env node
// Dependency-free secret scanner for the pre-commit hook.
//   node scripts/secret-scan.mjs          scan staged files (what will be committed)
//   node scripts/secret-scan.mjs --all    scan every tracked file
// Security: findings print file, line and rule name ONLY, never the matched text,
// so the scan output can't leak the secret it found.
import { execFileSync } from 'node:child_process'

const RULES = [
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'AWS access key id', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Anthropic/OpenAI style key', re: /\bsk-[A-Za-z0-9_-]{24,}\b/ },
  {
    name: 'hard-coded secret assignment',
    re: /\b(secret|token|passw(or)?d|api[_-]?key|private[_-]?key)\w*["']?\s*[:=]\s*["'][A-Za-z0-9+/_=-]{20,}["']/i,
  },
]
// Lines containing these markers are placeholders, not secrets.
const PLACEHOLDER = /replace-me|your[-_]|example|changeme|placeholder|<[^>]+>|process\.env/i

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const all = process.argv.includes('--all')
const files = (
  all
    ? git(['ls-files', '-z'])
    : git(['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'])
)
  .split('\0')
  .filter(Boolean)

const findings = []
for (const file of files) {
  const base = file.split('/').pop() ?? file
  if (/^\.env/.test(base) && base !== '.env.example') {
    findings.push(`${file}: env file must not be committed`)
    continue
  }
  if (file === 'package-lock.json' || /\.(png|jpg|jpeg|gif|ico|woff2?|ttf)$/i.test(file)) continue
  let text
  try {
    text = all ? git(['show', `HEAD:${file}`]) : git(['show', `:${file}`])
  } catch {
    continue
  }
  text.split('\n').forEach((line, i) => {
    if (PLACEHOLDER.test(line)) return
    for (const rule of RULES) {
      if (rule.re.test(line)) findings.push(`${file}:${i + 1}: possible ${rule.name}`)
    }
  })
}

if (findings.length > 0) {
  console.error('Secret scan FAILED (matched text intentionally not shown):')
  for (const f of findings) console.error(`  - ${f}`)
  console.error('If a finding is a false positive, make the value an obvious placeholder.')
  process.exit(1)
}
console.log(`Secret scan passed (${files.length} files).`)
