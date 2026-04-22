import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getProjectRoot, setProjectRoot } from '../../bootstrap/state.js'
import {
  buildKairosSessionMemoryPrompt,
  hasPendingKairosSessionMemoryTask,
  KAIROS_SESSION_MEMORY_MARKER,
  scheduleKairosSessionMemoryTask,
} from './sessionSummaryTask.js'

const TEMP_DIRS: string[] = []
let originalProjectRoot: string

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-memory-task-'))
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

describe('sessionSummaryTask', () => {
  test('builds a prompt tagged with the session-memory marker', () => {
    const prompt = buildKairosSessionMemoryPrompt({
      transcriptDir: '/tmp/project',
      sessionIds: ['sess-1', 'sess-2'],
    })
    expect(prompt.startsWith(KAIROS_SESSION_MEMORY_MARKER)).toBe(true)
    expect(prompt).toContain('sess-1')
    expect(prompt).toContain('summarizeAndIndexSessions')
  })

  test('schedules exactly one durable task for a batch', async () => {
    const projectDir = makeProjectDir()
    setProjectRoot(projectDir)

    const first = await scheduleKairosSessionMemoryTask({
      transcriptDir: join(projectDir, '.claude', 'projects'),
      sessionIds: ['sess-1', 'sess-2'],
    })
    const second = await scheduleKairosSessionMemoryTask({
      transcriptDir: join(projectDir, '.claude', 'projects'),
      sessionIds: ['sess-1', 'sess-2'],
    })

    expect(first.scheduled).toBe(true)
    expect(second).toEqual({ scheduled: false, reason: 'duplicate' })
    expect(await hasPendingKairosSessionMemoryTask()).toBe(true)

    const raw = readFileSync(
      join(projectDir, '.claude', 'scheduled_tasks.json'),
      'utf8',
    )
    const parsed = JSON.parse(raw) as {
      tasks: Array<{ prompt: string; recurring?: boolean }>
    }
    expect(parsed.tasks).toHaveLength(1)
    expect(parsed.tasks[0]?.prompt.startsWith(KAIROS_SESSION_MEMORY_MARKER)).toBe(true)
    expect(parsed.tasks[0]?.recurring).toBeUndefined()
  })
})
