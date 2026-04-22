import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getProjectRoot,
  setProjectRoot,
} from '../../bootstrap/state.js'
import { call } from './remind.js'

const TEMP_DIRS: string[] = []
let originalProjectRoot: string

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-remind-command-'))
  TEMP_DIRS.push(dir)
  return dir
}

function readScheduledTasks(projectDir: string): {
  tasks: Array<{
    id: string
    cron: string
    prompt: string
    createdAt: number
  }>
} {
  return JSON.parse(
    readFileSync(join(projectDir, '.claude', 'scheduled_tasks.json'), 'utf-8'),
  )
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

describe('/remind command', () => {
  test('routes user input through the reminder request flow and scheduler core', async () => {
    const projectDir = makeProjectDir()
    setProjectRoot(projectDir)

    const result = await call(
      '2026-05-15T14:02:00.000Z | Drink water.',
      {} as never,
    )

    expect(result.type).toBe('text')
    if (result.type !== 'text') return
    expect(result.value).toContain('Reminder scheduled for')
    expect(result.value).toContain('"Drink water."')

    expect(readScheduledTasks(projectDir).tasks).toHaveLength(1)
    expect(readScheduledTasks(projectDir).tasks[0]).toMatchObject({
      prompt: 'Drink water.',
    })
  })
})
