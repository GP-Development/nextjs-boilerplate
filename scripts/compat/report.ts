import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Status } from './lib.ts'

export type TestRecord = {
  id: string
  feature: string
  name: string
  status: Status
  reason: string
  durationMs: number
  expected?: boolean
}

export type Report = {
  host: string
  target: string
  mode: string
  variant: string
  date: string
  startedAt: string
  runnerNode: string
  summary: Record<Status, number>
  results: TestRecord[]
}

const COLORS: Record<Status, string> = { PASS: '32', FAIL: '31', PARTIAL: '33', SKIPPED: '90' }
const useColor = process.stdout.isTTY && !process.env.NO_COLOR
export const color = (status: Status, text: string) =>
  useColor ? `\x1b[${COLORS[status]}m${text}\x1b[0m` : text

export function summarize(results: TestRecord[]): Record<Status, number> {
  const summary: Record<Status, number> = { PASS: 0, FAIL: 0, PARTIAL: 0, SKIPPED: 0 }
  for (const r of results) summary[r.status]++
  return summary
}

const escapeCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

export function toMarkdown(report: Report): string {
  const rows = report.results.map(
    (r) => `| ${r.feature} | ${escapeCell(r.name)} | ${r.status} | ${escapeCell(r.reason)} |`,
  )
  const s = report.summary
  return [
    `### ${report.host} (${report.date}, mode: ${report.mode}, variant: ${report.variant})`,
    '',
    `PASS ${s.PASS} · PARTIAL ${s.PARTIAL} · FAIL ${s.FAIL} · SKIPPED ${s.SKIPPED}`,
    '',
    '| # | Test | Status | Reason |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
}

export function printConsole(report: Report): void {
  console.log(
    `\n${report.host}  ${report.target}  (mode: ${report.mode}, variant: ${report.variant})\n`,
  )
  for (const r of report.results) {
    const tag = color(r.status, r.status.padEnd(7))
    console.log(`  ${tag} ${r.feature.padStart(2)} ${r.name}`)
    console.log(`          ${r.reason}  (${(r.durationMs / 1000).toFixed(1)}s)`)
  }
  const s = report.summary
  console.log(
    `\n  ${color('PASS', `PASS ${s.PASS}`)}  ${color('PARTIAL', `PARTIAL ${s.PARTIAL}`)}  ${color('FAIL', `FAIL ${s.FAIL}`)}  ${color('SKIPPED', `SKIPPED ${s.SKIPPED}`)}\n`,
  )
}

/** Writes reports/<host>-<date>.json and .md. `host` is already sanitized by the CLI. */
export function writeReports(report: Report, dir: string, redact: (s: string) => string): string[] {
  mkdirSync(dir, { recursive: true })
  const base = join(dir, `${report.host}-${report.date}`)
  // Redact AFTER serialising so a secret can never slip in through any field.
  writeFileSync(`${base}.json`, redact(JSON.stringify(report, null, 2)) + '\n')
  writeFileSync(`${base}.md`, redact(toMarkdown(report)))
  return [`${base}.json`, `${base}.md`]
}
