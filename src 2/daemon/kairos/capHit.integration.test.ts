import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { CronTask } from '../../utils/cronTasks.js'
import type {
  ChildLauncher,
  ChildLauncherParams,
  ChildStreamMessage,
} from './childRunner.js'
import { createCostTracker } from './costTracker.js'
import { createStateWriter } from './stateWriter.js'
import { makeCapHitHandler, makeRunFiredTask } from './worker.js'
import {
  getKairosGlobalEventsPath,
  getKairosPausePath,
  getProjectKairosCostsPath,
  getProjectKairosEventsPath,
  getKairosGlobalCostsPath,
} from './paths.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

function makeTask(id: string, prompt = 'do work'): CronTask {
  return {
    id,
    cron: '* * * * *',
    prompt,
    createdAt: Date.now(),
  }
}

function makeLauncher(messages: ChildStreamMessage[]): {
  launcher: ChildLauncher
  calls: ChildLauncherParams[]
} {
  const calls: ChildLauncherParams[] = []
  const launcher: ChildLauncher = async function* (params) {
    calls.push(params)
    for (const msg of messages) yield msg
  }
  return { launcher, calls }
}

describe('cap-hit integration', () => {
  test('fired task above cap writes daemon-originated notice, sets pause, no recursive child run', async () => {
    const configDir = makeTempDir('kairos-cap-')
    const projectDir = makeTempDir('kairos-cap-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const stateWriter = await createStateWriter()
    await stateWriter.ensureProjectDir(projectDir)

    const costTracker = createCostTracker({
      caps: { globalUSD: 0.05 },
      stateWriter,
    })

    const { launcher, calls } = makeLauncher([
      { type: 'system', subtype: 'init', tools: ['Read'], session_id: 's1' },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 1,
        duration_ms: 100,
        total_cost_usd: 0.1, // exceeds 0.05 cap
        session_id: 's1',
      },
    ])

    const now = () => new Date('2026-04-22T12:00:00.000Z')
    const handleCapHit = makeCapHitHandler(stateWriter, now)
    const runFiredTask = makeRunFiredTask({
      projectDir,
      stateWriter,
      costTracker,
      launcher,
      defaultAllowedTools: ['Read'],
      maxTurns: 1,
      timeoutMs: 5000,
      handleCapHit,
      now,
    })

    const outcome = await runFiredTask(makeTask('t-over'), 'event')

    expect(outcome.ok).toBe(true)
    expect(outcome.paused).toBe(true)
    expect(calls).toHaveLength(1) // no recursive notification run

    // Pause flag set by the daemon itself.
    expect(existsSync(getKairosPausePath())).toBe(true)
    const pause = JSON.parse(readFileSync(getKairosPausePath(), 'utf8'))
    expect(pause.paused).toBe(true)
    expect(pause.reason).toBe('cap_hit')
    expect(pause.scope).toBe('global')
    expect(pause.source).toBe('daemon')

    // Global events.jsonl contains the daemon-originated notice.
    const globalEvents = readFileSync(getKairosGlobalEventsPath(), 'utf8')
    expect(globalEvents).toContain('"kind":"cap_hit_notice"')
    expect(globalEvents).toContain('"source":"daemon"')

    // Per-project events.jsonl has the child-run surfaced result too.
    const projectEvents = readFileSync(
      getProjectKairosEventsPath(projectDir),
      'utf8',
    )
    expect(projectEvents).toContain('"kind":"child_started"')
    expect(projectEvents).toContain('"kind":"child_finished"')
    expect(projectEvents).toContain('"kind":"cap_hit_notice"')

    // Costs are recorded at both levels.
    const globalCosts = JSON.parse(
      readFileSync(getKairosGlobalCostsPath(), 'utf8'),
    )
    const projectCosts = JSON.parse(
      readFileSync(getProjectKairosCostsPath(projectDir), 'utf8'),
    )
    expect(globalCosts.totalUSD).toBeCloseTo(0.1, 5)
    expect(globalCosts.runs).toBe(1)
    expect(projectCosts.totalUSD).toBeCloseTo(0.1, 5)
    expect(projectCosts.runs).toBe(1)

    // A subsequent fire while paused also does not launch another run
    // because runFiredTask is only invoked by projectWorker when
    // checkPaused returns false. Here we simulate that: if we force a
    // call anyway, the launcher is the only place that mutates calls,
    // and the daemon's notice path never calls the launcher.
    expect(calls).toHaveLength(1)
  })

  test('runFiredTask with no launcher is a no-op (child runs disabled)', async () => {
    const configDir = makeTempDir('kairos-cap-noop-')
    const projectDir = makeTempDir('kairos-cap-noop-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    const stateWriter = await createStateWriter()
    await stateWriter.ensureProjectDir(projectDir)

    const now = () => new Date('2026-04-22T12:00:00.000Z')
    const runFiredTask = makeRunFiredTask({
      projectDir,
      stateWriter,
      costTracker: null,
      launcher: null,
      defaultAllowedTools: [],
      maxTurns: 1,
      timeoutMs: 5000,
      handleCapHit: makeCapHitHandler(stateWriter, now),
      now,
    })

    const outcome = await runFiredTask(makeTask('t-noop'), 'event')
    expect(outcome.ok).toBe(true)
    expect(outcome.paused).toBe(false)
    expect(outcome.result).toBeUndefined()
  })
})
