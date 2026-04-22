import { describe, expect, test } from 'bun:test'
import { createCostTracker } from './costTracker.js'
import type { CostsFile } from './stateWriter.js'

function inMemoryStateWriter() {
  const globalCosts = { current: null as CostsFile | null }
  const projectCosts = new Map<string, CostsFile>()

  return {
    async readGlobalCosts() {
      return globalCosts.current
    },
    async writeGlobalCosts(c: CostsFile) {
      globalCosts.current = c
    },
    async readProjectCosts(dir: string) {
      return projectCosts.get(dir) ?? null
    },
    async writeProjectCosts(dir: string, c: CostsFile) {
      projectCosts.set(dir, c)
    },
    inspect() {
      return { global: globalCosts.current, projects: projectCosts }
    },
  }
}

describe('costTracker', () => {
  test('records per-project and global totals on every run', async () => {
    const stateWriter = inMemoryStateWriter()
    const tracker = createCostTracker({
      caps: {},
      stateWriter,
    })

    await tracker.record({
      projectDir: '/p/a',
      taskId: 't1',
      runId: 'r1',
      costUSD: 0.1,
      numTurns: 2,
      durationMs: 1000,
    })
    await tracker.record({
      projectDir: '/p/a',
      taskId: 't2',
      runId: 'r2',
      costUSD: 0.2,
      numTurns: 3,
      durationMs: 2000,
    })
    await tracker.record({
      projectDir: '/p/b',
      taskId: 't3',
      runId: 'r3',
      costUSD: 0.5,
      numTurns: 1,
      durationMs: 500,
    })

    const snap = stateWriter.inspect()
    expect(snap.global?.totalUSD).toBeCloseTo(0.8, 5)
    expect(snap.global?.runs).toBe(3)
    expect(snap.projects.get('/p/a')?.totalUSD).toBeCloseTo(0.3, 5)
    expect(snap.projects.get('/p/a')?.runs).toBe(2)
    expect(snap.projects.get('/p/b')?.totalUSD).toBeCloseTo(0.5, 5)
    expect(snap.projects.get('/p/b')?.runs).toBe(1)
  })

  test('per-project cap triggers cap-hit scoped to project', async () => {
    const stateWriter = inMemoryStateWriter()
    const tracker = createCostTracker({
      caps: { perProjectUSD: 0.5 },
      stateWriter,
    })

    const r1 = await tracker.record({
      projectDir: '/p/a',
      taskId: 't1',
      runId: 'r1',
      costUSD: 0.2,
      numTurns: 1,
      durationMs: 100,
    })
    expect(r1.capHit).toBeNull()

    const r2 = await tracker.record({
      projectDir: '/p/a',
      taskId: 't2',
      runId: 'r2',
      costUSD: 0.4,
      numTurns: 1,
      durationMs: 100,
    })
    expect(r2.capHit).not.toBeNull()
    expect(r2.capHit?.scope).toBe('project')
    expect(r2.capHit?.cap).toBe(0.5)
    expect(r2.capHit?.current).toBeCloseTo(0.6, 5)
  })

  test('global cap takes precedence over per-project cap when both trip', async () => {
    const stateWriter = inMemoryStateWriter()
    const tracker = createCostTracker({
      caps: { perProjectUSD: 0.1, globalUSD: 0.1 },
      stateWriter,
    })

    const out = await tracker.record({
      projectDir: '/p/a',
      taskId: 't1',
      runId: 'r1',
      costUSD: 0.2,
      numTurns: 1,
      durationMs: 100,
    })

    expect(out.capHit?.scope).toBe('global')
  })

  test('cap-hit only fires when totals reach the cap — below cap returns null', async () => {
    const stateWriter = inMemoryStateWriter()
    const tracker = createCostTracker({
      caps: { globalUSD: 1 },
      stateWriter,
    })

    const out = await tracker.record({
      projectDir: '/p/a',
      taskId: 't1',
      runId: 'r1',
      costUSD: 0.3,
      numTurns: 1,
      durationMs: 100,
    })
    expect(out.capHit).toBeNull()
    expect(out.globalTotal).toBeCloseTo(0.3, 5)
  })
})
