import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scheduleReminder } from './reminderScheduler.js'
import { ReminderValidationError } from './reminderValidation.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-reminder-test-'))
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

describe('scheduleReminder', () => {
  test('writes a durable one-shot task for a future reminder', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:00.000Z')
    const at = new Date('2026-05-15T14:02:00.000Z')

    const result = await scheduleReminder(
      { projectDir, text: 'Drink water.', at },
      { now, generateId: () => 'abcd1234' },
    )

    expect(result.status).toBe('scheduled')
    expect(result.id).toBe('abcd1234')
    expect(result.text).toBe('Drink water.')
    expect(result.at.getTime()).toBe(at.getTime())
    expect(result.filePath).toBe(
      join(projectDir, '.claude', 'scheduled_tasks.json'),
    )

    const file = readScheduledTasks(projectDir)
    expect(file.tasks).toHaveLength(1)
    const [task] = file.tasks
    expect(task).toMatchObject({
      id: 'abcd1234',
      prompt: 'Drink water.',
      createdAt: now.getTime(),
    })
    expect(task!.recurring).toBeUndefined()
    // Cron string corresponds to the target minute in local time; just
    // confirm the shape is the durable one-shot cron format.
    expect(task!.cron.split(/\s+/)).toHaveLength(5)
    expect(task!.cron).toBe(result.cron)
  })

  test('rejects a reminder whose target time is in the past', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:00.000Z')
    const at = new Date('2026-05-15T13:00:00.000Z')

    await expect(
      scheduleReminder({ projectDir, text: 'Drink water.', at }, { now }),
    ).rejects.toMatchObject({
      name: 'ReminderValidationError',
      code: 'past_time',
    })

    // No file should have been written.
    expect(() => readScheduledTasks(projectDir)).toThrow()
  })

  test('rejects a reminder for the current minute as past', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:30.000Z')
    const at = new Date('2026-05-15T14:00:00.000Z')

    await expect(
      scheduleReminder({ projectDir, text: 'Drink water.', at }, { now }),
    ).rejects.toBeInstanceOf(ReminderValidationError)
  })

  test('rejects empty reminder text', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:00.000Z')

    await expect(
      scheduleReminder(
        {
          projectDir,
          text: '   ',
          at: new Date('2026-05-15T14:02:00.000Z'),
        },
        { now },
      ),
    ).rejects.toMatchObject({
      code: 'empty_text',
    })
  })

  test('rejects unparseable target times', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:00.000Z')

    await expect(
      scheduleReminder(
        { projectDir, text: 'Drink water.', at: 'not-a-date' },
        { now },
      ),
    ).rejects.toMatchObject({
      code: 'invalid_time',
    })
  })

  test('does not create a duplicate when the same reminder is requested twice', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:00.000Z')
    const at = new Date('2026-05-15T14:02:00.000Z')

    let idCounter = 0
    const generateId = () => `id${++idCounter}`

    const first = await scheduleReminder(
      { projectDir, text: 'Drink water.', at },
      { now, generateId },
    )
    expect(first.status).toBe('scheduled')
    expect(first.id).toBe('id1')

    const second = await scheduleReminder(
      { projectDir, text: 'Drink water.', at },
      { now, generateId },
    )

    expect(second.status).toBe('duplicate')
    expect(second.id).toBe('id1')
    // generateId was never consumed by the duplicate path.
    expect(idCounter).toBe(1)

    const file = readScheduledTasks(projectDir)
    expect(file.tasks).toHaveLength(1)
    expect(file.tasks[0]!.id).toBe('id1')
  })

  test('different reminder text at the same minute is not a duplicate', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:00.000Z')
    const at = new Date('2026-05-15T14:02:00.000Z')

    let idCounter = 0
    const generateId = () => `id${++idCounter}`

    await scheduleReminder(
      { projectDir, text: 'Drink water.', at },
      { now, generateId },
    )
    const second = await scheduleReminder(
      { projectDir, text: 'Stretch.', at },
      { now, generateId },
    )

    expect(second.status).toBe('scheduled')
    expect(second.id).toBe('id2')

    const file = readScheduledTasks(projectDir)
    expect(file.tasks.map(t => t.prompt).sort()).toEqual([
      'Drink water.',
      'Stretch.',
    ])
  })

  test('rejects reminders more than a year out (cannot be expressed as 5-field cron)', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:00.000Z')
    // Two years out — a 5-field cron cannot distinguish from one year out.
    const at = new Date('2028-05-15T14:02:00.000Z')

    await expect(
      scheduleReminder({ projectDir, text: 'Annual.', at }, { now }),
    ).rejects.toMatchObject({
      code: 'unreachable_time',
    })
  })

  test('rounds sub-minute precision up to the next whole minute', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:00.000Z')
    // 14:02:45 → rounds to 14:03:00
    const at = new Date('2026-05-15T14:02:45.000Z')

    const result = await scheduleReminder(
      { projectDir, text: 'Ping.', at },
      { now, generateId: () => 'rounded1' },
    )

    expect(result.at.getUTCMinutes()).toBe(3)
    expect(result.at.getUTCSeconds()).toBe(0)
    expect(result.at.getUTCMilliseconds()).toBe(0)
  })
})
