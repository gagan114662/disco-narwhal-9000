/**
 * Bundle artifact verification: size budget + forbidden externals scan.
 * Runs against the build output produced by `bun run build`.
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

type BudgetConfig = {
  maxBytes: number
  maxStartupMs: number
  forbiddenExternals: string[]
  allowedExternals: string[]
}

const BUDGET_PATH = join(import.meta.dir, '..', '.bundle-budget.json')
const BUNDLE_PATH = join(import.meta.dir, '..', 'dist', 'cli.js')

function loadBudget(): BudgetConfig {
  return JSON.parse(readFileSync(BUDGET_PATH, 'utf8')) as BudgetConfig
}

function checkSize(budget: BudgetConfig): string[] {
  if (!existsSync(BUNDLE_PATH)) {
    return [`bundle missing at ${BUNDLE_PATH} - run "bun run build" first`]
  }
  const size = statSync(BUNDLE_PATH).size
  console.log(`bundle size: ${size} bytes (budget: ${budget.maxBytes})`)
  if (size > budget.maxBytes) {
    return [
      `bundle is ${size} bytes, exceeds budget of ${budget.maxBytes} (${(((size - budget.maxBytes) / budget.maxBytes) * 100).toFixed(1)}% over)`,
    ]
  }
  return []
}

function scanExternals(budget: BudgetConfig): string[] {
  const errors: string[] = []
  const source = readFileSync(BUNDLE_PATH, 'utf8')

  // bun build leaves --external imports as bare specifiers / require() calls
  // in the emitted ESM. Look for any specifier that isn't on the allowlist.
  const importRegex = /(?:from\s+|require\(\s*|import\(\s*)['"]([^'"\n]+)['"]/g
  const found = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = importRegex.exec(source))) {
    const spec = m[1]
    if (!spec) continue
    if (spec.startsWith('.') || spec.startsWith('/')) continue
    if (spec.startsWith('node:')) continue
    if (spec.startsWith('bun:')) continue
    // Skip false positives where the regex matched a string literal that
    // happens to be passed to `from`/`require`/`import` lookalikes (template
    // strings, embedded expressions, URLs, etc.) rather than a real bundler
    // import target.
    if (spec.includes('${')) continue
    if (spec.includes(' ')) continue
    if (spec.includes('://')) continue
    if (spec.startsWith('github.com/')) continue
    found.add(spec)
  }

  for (const spec of found) {
    if (budget.forbiddenExternals.some(f => spec === f || spec.startsWith(`${f}/`))) {
      errors.push(`forbidden external import in bundle: ${spec}`)
    }
  }

  const NODE_BUILTINS = new Set([
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
    'constants', 'crypto', 'dgram', 'dns', 'diagnostics_channel', 'domain',
    'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
    'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks',
    'process', 'punycode', 'querystring', 'readline', 'repl', 'stream',
    'stream/promises', 'stream/web', 'string_decoder', 'sys', 'timers',
    'timers/promises', 'tls', 'tty', 'url', 'util', 'util/types', 'v8',
    'vm', 'wasi', 'worker_threads', 'zlib',
  ])
  const unexpected = [...found].filter(
    s =>
      !NODE_BUILTINS.has(s) &&
      !budget.allowedExternals.some(a => s === a || s.startsWith(`${a}/`)),
  )
  if (unexpected.length > 0) {
    console.log(
      `note: ${unexpected.length} external specifier(s) seen that are not on the allowlist:`,
    )
    for (const u of unexpected.slice(0, 30)) console.log(`  - ${u}`)
    if (unexpected.length > 30) console.log(`  ...and ${unexpected.length - 30} more`)
  }

  return errors
}

async function checkStartup(budget: BudgetConfig): Promise<string[]> {
  const start = performance.now()
  const proc = Bun.spawn(['bun', BUNDLE_PATH, '--version'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const exitCode = await proc.exited
  const elapsed = performance.now() - start
  console.log(`bundle startup (--version): ${elapsed.toFixed(0)}ms (budget: ${budget.maxStartupMs}ms)`)
  if (exitCode !== 0) {
    return [`bundle exited non-zero (${exitCode}) on --version`]
  }
  if (elapsed > budget.maxStartupMs) {
    return [
      `bundle startup is ${elapsed.toFixed(0)}ms, exceeds budget of ${budget.maxStartupMs}ms`,
    ]
  }
  return []
}

async function main(): Promise<void> {
  const budget = loadBudget()
  const errors: string[] = []
  errors.push(...checkSize(budget))
  if (errors.length === 0) {
    errors.push(...scanExternals(budget))
    errors.push(...(await checkStartup(budget)))
  }
  if (errors.length > 0) {
    for (const e of errors) console.error(`  FAIL: ${e}`)
    process.exit(1)
  }
  console.log('bundle budget: OK')
}

if (import.meta.main) {
  await main()
}
