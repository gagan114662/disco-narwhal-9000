/**
 * Full-tree ESLint with a baseline file.
 *
 * Runs eslint over the whole src 2 tree, parses the JSON formatter output,
 * and compares per-file error counts against a committed baseline. Same
 * rules as the typecheck baseline:
 *   - file in baseline: count must not exceed baseline value
 *   - file NOT in baseline: must have zero errors
 *
 * Usage:
 *   bun ./scripts/lintBaseline.ts          # gate mode
 *   bun ./scripts/lintBaseline.ts --update # rewrite the baseline
 */
import { spawnSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, relative, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '..')
const BASELINE = join(ROOT, '.lint-baseline.json')

type EslintMessage = { severity: number }
type EslintFileResult = {
  filePath: string
  messages: EslintMessage[]
  errorCount: number
}

type Baseline = {
  generatedAt: string
  totalErrors: number
  perFile: Record<string, number>
}

function runEslint(): EslintFileResult[] {
  const eslintBin = join(ROOT, 'node_modules', '.bin', 'eslint')
  const r = spawnSync(
    eslintBin,
    ['.', '--ext', '.ts,.tsx,.js,.mjs,.cjs', '--format', 'json', '--no-error-on-unmatched-pattern'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    },
  )
  if (r.error) throw r.error
  const stdout = r.stdout ?? ''
  if (!stdout.trim()) {
    if (r.status !== 0) {
      throw new Error(`eslint exited ${r.status} with no JSON output: ${r.stderr}`)
    }
    return []
  }
  return JSON.parse(stdout) as EslintFileResult[]
}

function tally(results: EslintFileResult[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of results) {
    if (r.errorCount === 0) continue
    const rel = relative(ROOT, r.filePath)
    out.set(rel, (out.get(rel) ?? 0) + r.errorCount)
  }
  return out
}

function loadBaseline(): Baseline {
  if (!existsSync(BASELINE)) {
    return { generatedAt: new Date(0).toISOString(), totalErrors: 0, perFile: {} }
  }
  return JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline
}

function saveBaseline(counts: Map<string, number>): void {
  const perFile: Record<string, number> = {}
  for (const [k, v] of [...counts.entries()].sort()) perFile[k] = v
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  writeFileSync(
    BASELINE,
    JSON.stringify({ generatedAt: new Date().toISOString(), totalErrors: total, perFile }, null, 2) + '\n',
  )
  console.log(`wrote lint baseline: ${total} errors across ${Object.keys(perFile).length} files`)
}

function compare(current: Map<string, number>, baseline: Baseline): string[] {
  const out: string[] = []
  for (const [file, count] of current) {
    const allowed = baseline.perFile[file] ?? 0
    if (count > allowed) out.push(`${file}: ${count} lint errors (baseline allows ${allowed})`)
  }
  return out
}

async function main(): Promise<void> {
  const update = process.argv.includes('--update')
  const results = runEslint()
  const counts = tally(results)
  console.log(`current: ${[...counts.values()].reduce((a, b) => a + b, 0)} lint errors across ${counts.size} files`)
  if (update) {
    saveBaseline(counts)
    return
  }
  const baseline = loadBaseline()
  const violations = compare(counts, baseline)
  if (violations.length > 0) {
    console.error('lint FAIL: net-new violations vs baseline:')
    for (const v of violations) console.error(`  - ${v}`)
    console.error(`\nIf intentional: bun ./scripts/lintBaseline.ts --update`)
    process.exit(1)
  }
  console.log('lint baseline: OK')
}

if (import.meta.main) {
  await main()
}
