/**
 * Full-tree typecheck with a baseline file.
 *
 * Runs `tsc --noEmit` over the entire src 2 codebase. The first run produces
 * a baseline JSON of {file: errorCount}. CI compares the current run to the
 * baseline and fails on any of:
 *
 *   - a file present in baseline whose error count INCREASED
 *   - a file NOT in baseline that has any errors at all (net-new file)
 *
 * Total error count may decrease freely. The baseline file is committed to
 * the repo so the gate moves with the codebase.
 *
 * Usage:
 *   bun ./scripts/typecheckBaseline.ts          # gate mode (default)
 *   bun ./scripts/typecheckBaseline.ts --update # rewrite the baseline
 */
import { spawnSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, relative, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '..')
const BASELINE = join(ROOT, '.typecheck-baseline.json')
const TSCONFIG = join(ROOT, 'tsconfig.full.json')

type Baseline = {
  generatedAt: string
  totalErrors: number
  perFile: Record<string, number>
}

function runTsc(): string {
  if (!existsSync(TSCONFIG)) {
    throw new Error(`missing ${TSCONFIG} - create a project-wide tsconfig before running this script`)
  }
  const tscBin = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tscBin, ['-p', TSCONFIG, '--noEmit', '--pretty', 'false'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  // tsc exits 0 on success, 1+ when diagnostics emitted. Either is fine -
  // we parse stdout regardless. stderr is reserved for tooling errors.
  if (r.error) throw r.error
  return (r.stdout ?? '') + (r.stderr ?? '')
}

const ERROR_RE = /^([^()\s][^()]*?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/

function parseDiagnostics(output: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of output.split('\n')) {
    const m = ERROR_RE.exec(line.trim())
    if (!m) continue
    const file = m[1]?.trim()
    if (!file) continue
    const rel = relative(ROOT, resolve(ROOT, file))
    counts.set(rel, (counts.get(rel) ?? 0) + 1)
  }
  return counts
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
  const baseline: Baseline = {
    generatedAt: new Date().toISOString(),
    totalErrors: total,
    perFile,
  }
  writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n')
  console.log(`wrote baseline: ${total} errors across ${Object.keys(perFile).length} files`)
}

function compareToBaseline(current: Map<string, number>, baseline: Baseline): string[] {
  const violations: string[] = []
  for (const [file, count] of current) {
    const allowed = baseline.perFile[file] ?? 0
    if (count > allowed) {
      violations.push(`${file}: ${count} errors (baseline allows ${allowed})`)
    }
  }
  return violations
}

async function main(): Promise<void> {
  const update = process.argv.includes('--update')
  const out = runTsc()
  const counts = parseDiagnostics(out)
  console.log(`current: ${[...counts.values()].reduce((a, b) => a + b, 0)} errors across ${counts.size} files`)
  if (update) {
    saveBaseline(counts)
    return
  }
  const baseline = loadBaseline()
  const violations = compareToBaseline(counts, baseline)
  if (violations.length > 0) {
    console.error('typecheck FAIL: net-new violations vs baseline:')
    for (const v of violations) console.error(`  - ${v}`)
    console.error(`\nIf the violations are intentional, regenerate baseline:`)
    console.error(`  bun ./scripts/typecheckBaseline.ts --update`)
    process.exit(1)
  }
  console.log('typecheck baseline: OK')
}

if (import.meta.main) {
  await main()
}
