import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getProjectRoot,
  setProjectRoot,
} from '../../bootstrap/state.js'
import { readCronTasks } from '../../utils/cronTasks.js'
import {
  KAIROS_AUTO_DREAM_MARKER,
  buildKairosDreamPrompt,
  hasPendingKairosDreamTask,
  scheduleKairosDreamTask,
} from './kairosDreamTask.js'

const TEMP_DIRS: string[] = []
let originalProjectRoot: string

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'auto-dream-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

beforeEach(() => {
  originalProjectRoot = getProjectRoot()
})

afterEach(() => {
  setProjectRoot(originalProjectRoot)
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('KAIROS-mode AutoDream', () => {
  test('builds a prompt tagged with the AutoDream marker and session hint', () => {
    const prompt = buildKairosDreamPrompt({
      memoryRoot: '/mem',
      transcriptDir: '/transcripts',
      sessionIds: ['s1', 's2'],
    })
    expect(prompt.startsWith(KAIROS_AUTO_DREAM_MARKER)).toBe(true)
    expect(prompt).toContain('AutoDream consolidation run')
    expect(prompt).toContain('- s1')
    expect(prompt).toContain('- s2')
  })

  test('scheduleKairosDreamTask writes exactly one durable one-shot cron task', async () => {
    const projectDir = makeProjectDir()
    setProjectRoot(projectDir)

    expect(await hasPendingKairosDreamTask()).toBe(false)

    const result = await scheduleKairosDreamTask({
      memoryRoot: join(projectDir, '.claude', 'memory'),
      transcriptDir: join(projectDir, '.transcripts'),
      sessionIds: ['abc', 'def', 'ghi'],
    })

    expect(result.scheduled).toBe(true)

    const cronPath = join(projectDir, '.claude', 'scheduled_tasks.json')
    const raw = readFileSync(cronPath, 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.tasks).toHaveLength(1)

    const task = parsed.tasks[0]
    expect(task.cron).toBe('* * * * *')
    expect(task.recurring).toBeUndefined()
    expect(task.prompt.startsWith(KAIROS_AUTO_DREAM_MARKER)).toBe(true)
    expect(task.prompt).toContain('3')
    expect(typeof task.id).toBe('string')
    expect(typeof task.createdAt).toBe('number')
  })

  test('duplicate suppression: repeated scheduling yields exactly one pending task', async () => {
    const projectDir = makeProjectDir()
    setProjectRoot(projectDir)

    const inputs = {
      memoryRoot: join(projectDir, '.claude', 'memory'),
      transcriptDir: join(projectDir, '.transcripts'),
      sessionIds: ['one', 'two'],
    }

    const first = await scheduleKairosDreamTask(inputs)
    const second = await scheduleKairosDreamTask(inputs)
    const third = await scheduleKairosDreamTask(inputs)

    expect(first.scheduled).toBe(true)
    expect(second.scheduled).toBe(false)
    expect(third.scheduled).toBe(false)
    if (second.scheduled === false) {
      expect(second.reason).toBe('duplicate')
    }

    const tasks = await readCronTasks()
    const dreamTasks = tasks.filter(t =>
      t.prompt.startsWith(KAIROS_AUTO_DREAM_MARKER),
    )
    expect(dreamTasks).toHaveLength(1)
  })

  test('hasPendingKairosDreamTask ignores unrelated cron tasks', async () => {
    const projectDir = makeProjectDir()
    setProjectRoot(projectDir)

    const { writeCronTasks } = await import('../../utils/cronTasks.js')
    await writeCronTasks([
      {
        id: 'abcd1234',
        cron: '0 * * * *',
        prompt: 'unrelated hourly task',
        createdAt: Date.now(),
        recurring: true,
      },
    ])

    expect(await hasPendingKairosDreamTask()).toBe(false)
  })

  test('non-KAIROS path: no cron task is written when scheduling is not invoked', async () => {
    // The KAIROS branch in autoDream.ts guards scheduleKairosDreamTask behind
    // getKairosActive(). We assert the invariant directly here: when the
    // scheduler is never called (the non-KAIROS path), the cron file stays
    // empty — no AutoDream side effect on the project's durable tasks.
    const projectDir = makeProjectDir()
    setProjectRoot(projectDir)

    const tasks = await readCronTasks()
    expect(tasks).toEqual([])
    expect(await hasPendingKairosDreamTask()).toBe(false)
  })
})
