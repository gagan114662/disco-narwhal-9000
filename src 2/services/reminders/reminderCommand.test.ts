import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseReminderCommandArgs,
  runReminderCommand,
} from './reminderCommand.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-remind-command-test-'))
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

describe('runReminderCommand', () => {
  test('parses the time and text segments around |', () => {
    expect(parseReminderCommandArgs('tomorrow 9am | Drink water.')).toEqual({
      at: 'tomorrow 9am',
      text: 'Drink water.',
    })
  })

  test('returns help text when the separator is missing', async () => {
    expect(await runReminderCommand('tomorrow 9am')).toContain(
      '/remind <time> | <text>',
    )
  })

  test('schedules a reminder through the user-facing reminder service', async () => {
    const projectDir = makeProjectDir()
    const now = new Date('2026-05-15T14:00:00.000Z')

    const message = await runReminderCommand(
      '2026-05-15T14:02:00.000Z | Drink water.',
      {
        projectDir,
        now,
        generateId: () => 'cmd12345',
        formatTime: at => at.toISOString(),
      },
    )

    expect(message).toBe(
      'Reminder scheduled for 2026-05-15T14:02:00.000Z: "Drink water.".',
    )
    expect(readScheduledTasks(projectDir).tasks).toHaveLength(1)
    expect(readScheduledTasks(projectDir).tasks[0]).toMatchObject({
      id: 'cmd12345',
      prompt: 'Drink water.',
      createdAt: now.getTime(),
    })
  })
})
