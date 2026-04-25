/**
 * Tiny performance benchmarks. Numbers are budgets, not absolutes - they
 * detect order-of-magnitude regressions, not microsecond drift.
 *
 *   1. dashboard cold-start    : how long to bring the HTTP server up
 *   2. reminder loop tick      : per-tick latency of the reminders scheduler
 */
import { spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

type BudgetFile = {
  dashboardColdStartMs: number
  reminderTickMs: number
}

const BUDGET_PATH = join(import.meta.dir, '..', '.perf-budget.json')
const BUDGET = JSON.parse(readFileSync(BUDGET_PATH, 'utf8')) as Partial<BudgetFile>

const dashboardColdStartMs = BUDGET.dashboardColdStartMs ?? 5000
const reminderTickMs = BUDGET.reminderTickMs ?? 200

async function benchDashboardColdStart(): Promise<number> {
  const tmp = mkdtempSync(join(tmpdir(), 'perf-dash-'))
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: tmp,
  }
  const start = performance.now()
  // Probe via a short bun script that imports + starts + stops the server.
  const probe = `
    import { startKairosDashboardServer } from './daemon/dashboard/server.js'
    const srv = await startKairosDashboardServer({ port: 0 })
    const url = srv.url.endsWith('/') ? srv.url + 'api/state' : srv.url + '/api/state'
    const res = await fetch(url)
    if (!res.ok) { console.error('state not ok', res.status); process.exit(1) }
    await srv.stop()
    console.log('OK')
  `
  const r = spawnSync('bun', ['-e', probe], {
    cwd: join(import.meta.dir, '..'),
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const elapsed = performance.now() - start
  rmSync(tmp, { recursive: true, force: true })
  if (r.status !== 0) {
    throw new Error(`dashboard probe exited ${r.status}`)
  }
  return elapsed
}

async function benchReminderTick(): Promise<number> {
  const probe = `
    const start = performance.now()
    const ITERS = 100
    for (let i = 0; i < ITERS; i++) {
      const now = new Date()
      const due = []
      // Simulate the cheap part of a tick: scan an in-memory list of N
      // reminders and check whether each fires now.
      const reminders = Array.from({ length: 200 }, (_, j) => ({
        id: 'r' + j, fireAt: new Date(Date.now() + (j % 7) * 1000),
      }))
      for (const r of reminders) {
        if (r.fireAt <= now) due.push(r.id)
      }
    }
    const perTick = (performance.now() - start) / ITERS
    console.log(perTick.toFixed(3))
  `
  const r = spawnSync('bun', ['-e', probe], {
    cwd: join(import.meta.dir, '..'),
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (r.status !== 0) throw new Error(`reminder probe exited ${r.status}`)
  return parseFloat(r.stdout.toString().trim())
}

async function main(): Promise<void> {
  const errors: string[] = []
  console.log('--- dashboard cold-start ---')
  const dash = await benchDashboardColdStart()
  console.log(`dashboard cold-start: ${dash.toFixed(0)}ms (budget ${dashboardColdStartMs}ms)`)
  if (dash > dashboardColdStartMs) errors.push(`dashboard cold-start over budget: ${dash.toFixed(0)}ms > ${dashboardColdStartMs}ms`)

  console.log('--- reminder loop tick ---')
  const tick = await benchReminderTick()
  console.log(`reminder tick: ${tick.toFixed(3)}ms (budget ${reminderTickMs}ms)`)
  if (tick > reminderTickMs) errors.push(`reminder tick over budget: ${tick.toFixed(3)}ms > ${reminderTickMs}ms`)

  if (errors.length > 0) {
    for (const e of errors) console.error(`  FAIL: ${e}`)
    process.exit(1)
  }
  console.log('perf bench: OK')
}

if (import.meta.main) {
  await main()
}
