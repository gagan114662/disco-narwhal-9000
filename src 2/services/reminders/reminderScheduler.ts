// Core reminder-scheduling layer for KAIROS.
//
// Turns a validated reminder request into exactly one durable one-shot
// entry in <projectDir>/.claude/scheduled_tasks.json. The daemon already
// knows how to fire durable cron tasks, so this service only needs to
// write the task file — it does not maintain a parallel scheduler.
//
// Deduplication: a second request for the same project + same fire minute
// + same text is reported as a duplicate and does NOT append a second
// pending entry. "Same fire minute" is compared via the generated cron
// string, which is minute-resolution by construction.

import { randomUUID } from 'node:crypto'
import {
  type CronTask,
  getCronFilePath,
  readCronTasks,
  writeCronTasks,
} from '../../utils/cronTasks.js'
import {
  type ReminderRequest,
  type ValidatedReminder,
  validateReminder,
} from './reminderValidation.js'

export type ScheduleReminderResult = {
  /**
   * `scheduled` — a new durable one-shot task was written.
   * `duplicate` — an equivalent pending task already existed; no-op write.
   */
  status: 'scheduled' | 'duplicate'
  id: string
  cron: string
  at: Date
  text: string
  projectDir: string
  filePath: string
}

export type ScheduleReminderDeps = {
  now?: Date
  /** Injected for tests; defaults to randomUUID().slice(0,8) for parity with addCronTask. */
  generateId?: () => string
}

function defaultGenerateId(): string {
  return randomUUID().slice(0, 8)
}

function findDuplicate(
  tasks: CronTask[],
  normalized: ValidatedReminder,
): CronTask | undefined {
  return tasks.find(
    t => !t.recurring && t.cron === normalized.cron && t.prompt === normalized.text,
  )
}

/**
 * Validate the request, check for an existing equivalent pending reminder,
 * and — if none exists — append a new durable one-shot task to the
 * project's scheduled_tasks.json. Returns the task id and enough context
 * for the caller to render a confirmation message.
 *
 * Throws {@link import('./reminderValidation').ReminderValidationError} on
 * bad input; all I/O errors surface from the underlying fs calls.
 */
export async function scheduleReminder(
  req: ReminderRequest,
  deps: ScheduleReminderDeps = {},
): Promise<ScheduleReminderResult> {
  const now = deps.now ?? new Date()
  const generateId = deps.generateId ?? defaultGenerateId
  const normalized = validateReminder(req, now)

  const existing = await readCronTasks(normalized.projectDir)
  const duplicate = findDuplicate(existing, normalized)
  const filePath = getCronFilePath(normalized.projectDir)

  if (duplicate) {
    return {
      status: 'duplicate',
      id: duplicate.id,
      cron: normalized.cron,
      at: normalized.at,
      text: normalized.text,
      projectDir: normalized.projectDir,
      filePath,
    }
  }

  const id = generateId()
  const task: CronTask = {
    id,
    cron: normalized.cron,
    prompt: normalized.text,
    createdAt: now.getTime(),
  }
  await writeCronTasks([...existing, task], normalized.projectDir)

  return {
    status: 'scheduled',
    id,
    cron: normalized.cron,
    at: normalized.at,
    text: normalized.text,
    projectDir: normalized.projectDir,
    filePath,
  }
}
