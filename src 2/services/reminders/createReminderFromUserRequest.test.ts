import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReminderFromUserRequest } from './createReminderFromUserRequest.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-reminder-ux-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

function readScheduledTasks(projectDir: string): {
  tasks: Array<{
    id: string
    cron: string
    prompt: string
    createdAt: number
    recurring?: boolean
  }>
} {
  const raw = readFileSync(
    join(projectDir, '.claude', 'scheduled_tasks.json'),
    'utf-8',
  )
  return JSON.parse(raw)
}

// Stable time formatter so assertions don't depend on the host TZ.
const isoFormat = (d: Date) => d.toISOString()

describe('createReminderFromUserRequest', () => {
  test('schedules a valid reminder and returns a user-facing confirmation', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:00.000Z')
    const at = new Date('2026-05-15T14:02:00.000Z')

    const result = await createReminderFromUserRequest(
      { projectDir, text: 'Drink water.', at },
      { now, generateId: () => 'abcd1234', formatTime: isoFormat },
    )

    expect(result).toEqual({
      ok: true,
      status: 'scheduled',
      id: 'abcd1234',
      at,
      text: 'Drink water.',
      projectDir,
      filePath: join(projectDir, '.claude', 'scheduled_tasks.json'),
      message:
        'Reminder scheduled for 2026-05-15T14:02:00.000Z: "Drink water.".',
    })

    // Delegation check: the scheduler core wrote the durable one-shot task.
    const file = readScheduledTasks(projectDir)
    expect(file.tasks).toHaveLength(1)
    expect(file.tasks[0]).toMatchObject({
      id: 'abcd1234',
      prompt: 'Drink water.',
      createdAt: now.getTime(),
    })
    expect(file.tasks[0]!.recurring).toBeUndefined()
  })

  test('duplicate request surfaces the existing reminder instead of adding a second entry', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:00.000Z')
    const at = new Date('2026-05-15T14:02:00.000Z')

    let idCounter = 0
    const generateId = () => `id${++idCounter}`

    const first = await createReminderFromUserRequest(
      { projectDir, text: 'Drink water.', at },
      { now, generateId, formatTime: isoFormat },
    )
    expect(first.ok && first.status).toBe('scheduled')

    const second = await createReminderFromUserRequest(
      { projectDir, text: 'Drink water.', at },
      { now, generateId, formatTime: isoFormat },
    )

    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.status).toBe('duplicate')
    expect(second.id).toBe('id1')
    expect(second.message).toBe(
      'Reminder for 2026-05-15T14:02:00.000Z already scheduled: "Drink water.". Keeping the existing one.',
    )

    // Exactly one task on disk — no second entry.
    expect(readScheduledTasks(projectDir).tasks).toHaveLength(1)
    // generateId was never consumed by the duplicate path.
    expect(idCounter).toBe(1)
  })

  test('empty text returns an actionable user-facing error and writes nothing', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:00.000Z')

    const result = await createReminderFromUserRequest(
      {
        projectDir,
        text: '   ',
        at: new Date('2026-05-15T14:02:00.000Z'),
      },
      { now },
    )

    expect(result).toEqual({
      ok: false,
      code: 'empty_text',
      message: "Can't schedule reminder: reminder text is empty.",
    })
    expect(() => readScheduledTasks(projectDir)).toThrow()
  })

  test('past-time request returns a user-facing error', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:00.000Z')
    const at = new Date('2026-05-15T13:00:00.000Z')

    const result = await createReminderFromUserRequest(
      { projectDir, text: 'Drink water.', at },
      { now },
    )

    expect(result).toEqual({
      ok: false,
      code: 'past_time',
      message:
        "Can't schedule reminder: that time is already in the past. Pick a future time.",
    })
    expect(() => readScheduledTasks(projectDir)).toThrow()
  })

  test('unparseable time returns a user-facing error with the raw input', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:00.000Z')

    const result = await createReminderFromUserRequest(
      { projectDir, text: 'Drink water.', at: 'not-a-date' },
      { now },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('invalid_time')
    expect(result.message).toBe(
      'Can\'t schedule reminder: couldn\'t parse the time "not-a-date".',
    )
  })

  test('reminder more than a year out returns an unreachable_time error', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:00.000Z')
    const at = new Date('2028-05-15T14:02:00.000Z')

    const result = await createReminderFromUserRequest(
      { projectDir, text: 'Annual.', at },
      { now },
    )

    expect(result).toEqual({
      ok: false,
      code: 'unreachable_time',
      message:
        "Can't schedule reminder: time must be within the next year.",
    })
  })

  test('missing projectDir returns an invalid_project error', async () => {
    const now = new Date('2026-05-15T14:00:00.000Z')
    const at = new Date('2026-05-15T14:02:00.000Z')

    const result = await createReminderFromUserRequest(
      // Force the validator to see an empty projectDir without touching disk.
      { projectDir: '', text: 'Drink water.', at },
      { now },
    )

    expect(result).toEqual({
      ok: false,
      code: 'invalid_project',
      message: "Can't schedule reminder: no project directory was provided.",
    })
  })
})
