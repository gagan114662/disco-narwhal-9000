import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { CronScheduler } from '../../utils/cronScheduler.js'
import type { CronTask } from '../../utils/cronTasks.js'
import type { ChildRunResult } from './childRunner.js'
import { createProjectRegistry } from './projectRegistry.js'
import { createProjectWorker } from './projectWorker.js'
import { createStateWriter } from './stateWriter.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempConfigDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

function makeTask(id: string): CronTask {
  return {
    id,
    cron: '* * * * *',
    prompt: `task ${id}`,
    createdAt: Date.now(),
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await Bun.sleep(25)
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`)
}

describe('Kairos project worker', () => {
  test('project registry reads, writes, and diffs projects.json', async () => {
    const configDir = makeTempConfigDir('kairos-registry-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const registry = await createProjectRegistry()
    expect(await registry.read()).toEqual([])

    await registry.write(['/repo/b', '/repo/a', '/repo/a'])
    expect(await registry.read()).toEqual(['/repo/a', '/repo/b'])

    const changes: Array<{ added: string[]; removed: string[] }> = []
    const stop = await registry.watch(change => {
      changes.push({ added: change.added, removed: change.removed })
    })

    await registry.write(['/repo/b', '/repo/c'])
    await waitFor(() => changes.length > 0)
    await stop()

    expect(changes).toEqual([
      {
        added: ['/repo/c'],
        removed: ['/repo/a'],
      },
    ])
  })

  test('coalesces overlapping fires into one catch-up pass', async () => {
    const configDir = makeTempConfigDir('kairos-worker-')
    const projectDir = makeTempConfigDir('kairos-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    let fireTask: ((task: CronTask) => void) | undefined
    const scheduler: CronScheduler = {
      start() {},
      stop() {},
      getNextFireTime() {
        return null
      },
    }

    const stateWriter = await createStateWriter()
    const worker = createProjectWorker(projectDir, {
      stateWriter,
      createScheduler(options) {
        fireTask = options.onFireTask
        return scheduler
      },
    })

    mkdirSync(join(projectDir, '.claude'), { recursive: true })
    writeFileSync(
      join(projectDir, '.claude', 'scheduled_tasks.json'),
      JSON.stringify(
        {
          tasks: [makeTask('first'), makeTask('second')],
        },
        null,
        2,
      ),
    )

    worker.start()
    fireTask?.(makeTask('first'))
    fireTask?.(makeTask('second'))

    await Bun.sleep(150)

    const log = readFileSync(
      join(projectDir, '.claude', 'kairos', 'log.jsonl'),
      'utf8',
    )
    expect(log).toContain('"kind":"overlap_coalesced"')
    expect(log).toContain('"kind":"catchup_started"')

    const catchupCount = log
      .split('\n')
      .filter(line => line.includes('"kind":"catchup_started"')).length
    expect(catchupCount).toBe(1)

    const firedCount = log
      .split('\n')
      .filter(line => line.includes('"kind":"fired"')).length
    expect(firedCount).toBe(2)

    const scheduledTasks = readFileSync(
      join(projectDir, '.claude', 'scheduled_tasks.json'),
      'utf8',
    )
    expect(scheduledTasks).toContain('"tasks": []')
  })

  test('invokes runFiredTask with fired task and stops draining on pause', async () => {
    const configDir = makeTempConfigDir('kairos-worker-child-')
    const projectDir = makeTempConfigDir('kairos-project-child-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    let fireTask: ((task: CronTask) => void) | undefined
    const scheduler: CronScheduler = {
      start() {},
      stop() {},
      getNextFireTime() {
        return null
      },
    }

    const stateWriter = await createStateWriter()
    const fakeResult: ChildRunResult = {
      runId: 'r1',
      ok: true,
      exitReason: 'completed',
      costUSD: 0.01,
      numTurns: 1,
      durationMs: 10,
      allowedTools: ['Read'],
    }

    const calls: Array<{ taskId: string; source: 'event' | 'catchup' }> = []
    let firesBeforePause = 0
    const runFiredTask = mock(
      async (task: CronTask, source: 'event' | 'catchup') => {
        calls.push({ taskId: task.id, source })
        firesBeforePause += 1
        const paused = firesBeforePause >= 1
        return { ok: true, paused, result: fakeResult }
      },
    )

    const worker = createProjectWorker(projectDir, {
      stateWriter,
      createScheduler(options) {
        fireTask = options.onFireTask
        return scheduler
      },
      runFiredTask,
    })

    worker.start()
    fireTask?.(makeTask('t1'))
    fireTask?.(makeTask('t2'))

    await Bun.sleep(150)

    expect(calls.length).toBe(1)
    expect(calls[0]).toEqual({ taskId: 't1', source: 'event' })
  })

  test('skips work while paused and records skipped_paused in per-project log', async () => {
    const configDir = makeTempConfigDir('kairos-worker-paused-')
    const projectDir = makeTempConfigDir('kairos-project-paused-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    let fireTask: ((task: CronTask) => void) | undefined
    const scheduler: CronScheduler = {
      start() {},
      stop() {},
      getNextFireTime() {
        return null
      },
    }

    const stateWriter = await createStateWriter()
    const runFiredTask = mock(
      async (_task: CronTask, _source: 'event' | 'catchup') => ({
        ok: true,
        paused: false,
      }),
    )

    const worker = createProjectWorker(projectDir, {
      stateWriter,
      createScheduler(options) {
        fireTask = options.onFireTask
        return scheduler
      },
      runFiredTask,
      checkPaused: async () => true,
    })

    worker.start()
    fireTask?.(makeTask('tp1'))

    await Bun.sleep(100)

    expect(runFiredTask).not.toHaveBeenCalled()

    const log = readFileSync(
      join(projectDir, '.claude', 'kairos', 'log.jsonl'),
      'utf8',
    )
    expect(log).toContain('"kind":"skipped_paused"')
    expect(log).toContain('"reason":"global_pause"')
  })
})
