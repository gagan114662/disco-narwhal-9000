/**
 * End-to-end smoke test for the KAIROS daemon dashboard.
 *
 * - Boots the dashboard server on an ephemeral port
 * - Hits the documented HTTP routes
 * - Snapshots the JSON response shape
 * - Shuts the server down cleanly
 *
 * This is intentionally NOT a unit test: it spins the real server (no mocks)
 * to catch wiring regressions that pass type-check + unit tests but would
 * crash the running daemon.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { startKairosDashboardServer } from '../daemon/dashboard/server.js'

type Snapshot = {
  route: string
  status: number
  contentType: string | null
  bodyShape?: unknown
  bodyBytes?: number
}

function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

async function fetchJson(url: string): Promise<Response> {
  return await fetch(url, { headers: { accept: 'application/json' } })
}

function shapeOf(value: unknown, depth = 0): unknown {
  if (depth > 4) return '<deep>'
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : [shapeOf(value[0], depth + 1)]
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as object)) {
      out[k] = shapeOf(v, depth + 1)
    }
    return out
  }
  return typeof value
}

async function main(): Promise<void> {
  const cfgDir = mkdtempSync(join(tmpdir(), 'dashboard-e2e-'))
  process.env.CLAUDE_CONFIG_DIR = cfgDir
  const server = await startKairosDashboardServer({ port: 0 })
  console.log(`dashboard up at ${server.url}`)
  const snapshots: Snapshot[] = []
  const errors: string[] = []
  try {
    // 1. Static index served as HTML
    const idx = await fetch(joinUrl(server.url, '/'))
    snapshots.push({
      route: '/',
      status: idx.status,
      contentType: idx.headers.get('content-type'),
      bodyBytes: (await idx.text()).length,
    })
    if (!idx.ok) errors.push(`/ returned ${idx.status}`)

    // 2. State JSON
    const state = await fetchJson(joinUrl(server.url, '/api/state'))
    const stateBody = (await state.json()) as unknown
    snapshots.push({
      route: '/api/state',
      status: state.status,
      contentType: state.headers.get('content-type'),
      bodyShape: shapeOf(stateBody),
    })
    if (!state.ok) errors.push(`/api/state returned ${state.status}`)

    // 3. SSE endpoint should respond with text/event-stream and stay alive
    //    long enough to write headers. We abort after first chunk.
    const ctrl = new AbortController()
    const sse = await fetch(joinUrl(server.url, '/api/events'), {
      signal: ctrl.signal,
    })
    snapshots.push({
      route: '/api/events',
      status: sse.status,
      contentType: sse.headers.get('content-type'),
    })
    ctrl.abort()
    if (sse.headers.get('content-type')?.includes('event-stream') !== true) {
      errors.push('/api/events did not return text/event-stream')
    }

    // 4. Static JS asset
    const js = await fetch(joinUrl(server.url, '/app.js'))
    snapshots.push({
      route: '/app.js',
      status: js.status,
      contentType: js.headers.get('content-type'),
      bodyBytes: (await js.text()).length,
    })
    if (!js.ok) errors.push(`/app.js returned ${js.status}`)
  } catch (err) {
    errors.push(`exception: ${(err as Error).message}`)
  } finally {
    await server.stop()
    rmSync(cfgDir, { recursive: true, force: true })
  }

  const out = join(import.meta.dir, '..', 'dist', 'dashboard-e2e-snapshot.json')
  try {
    writeFileSync(out, JSON.stringify(snapshots, null, 2) + '\n')
    console.log(`snapshot written to ${out}`)
  } catch {
    // dist may not exist on first run; ignore
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(`  FAIL: ${e}`)
    process.exit(1)
  }
  console.log('dashboard E2E: OK')
  console.log(JSON.stringify(snapshots, null, 2))
}

if (import.meta.main) {
  await main()
}
