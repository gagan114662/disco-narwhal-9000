// Pure validation + normalization for KAIROS reminder requests.
//
// A reminder request names a target wall-clock time and reminder text. The
// daemon only knows how to fire durable one-shot cron tasks, so validation
// has two jobs:
//
//   1. Reject inputs the daemon can't act on: empty text, missing project,
//      unparseable time, time in the past, time so far out the 5-field cron
//      can't uniquely identify it.
//   2. Normalize the surviving request into { text, at, cron } so the
//      scheduler can write it verbatim and the deduper can compare by
//      cron string equality.
//
// The validator does NOT touch disk. reminderScheduler.ts owns all I/O.

import { nextCronRunMs } from '../../utils/cronTasks.js'

export type ReminderRequest = {
  projectDir: string
  text: string
  at: Date | number | string
}

export type ValidatedReminder = {
  projectDir: string
  text: string
  at: Date
  cron: string
}

export type ReminderErrorCode =
  | 'invalid_project'
  | 'empty_text'
  | 'invalid_time'
  | 'past_time'
  | 'unreachable_time'

export class ReminderValidationError extends Error {
  readonly code: ReminderErrorCode
  constructor(code: ReminderErrorCode, message: string) {
    super(message)
    this.name = 'ReminderValidationError'
    this.code = code
  }
}

function toDate(at: Date | number | string): Date | null {
  if (at instanceof Date) {
    return Number.isFinite(at.getTime()) ? new Date(at.getTime()) : null
  }
  if (typeof at === 'number') {
    if (!Number.isFinite(at)) return null
    return new Date(at)
  }
  if (typeof at === 'string') {
    const d = new Date(at)
    return Number.isFinite(d.getTime()) ? d : null
  }
  return null
}

// Cron resolution is whole minutes. Round the target up so a reminder for
// 14:30:45 fires at 14:31:00 rather than waiting a year for the :30 mark.
function roundUpToMinute(d: Date): Date {
  if (d.getSeconds() === 0 && d.getMilliseconds() === 0) {
    return new Date(d.getTime())
  }
  const r = new Date(d.getTime())
  r.setSeconds(0, 0)
  r.setMinutes(r.getMinutes() + 1)
  return r
}

/**
 * Build the one-shot cron string that fires once at exactly `at`.
 *
 * Pins minute + hour + dayOfMonth + month; leaves dayOfWeek as wildcard so
 * standard "either" semantics reduce to the single dom/month match.
 */
export function toOneShotCron(at: Date): string {
  return [
    at.getMinutes(),
    at.getHours(),
    at.getDate(),
    at.getMonth() + 1,
    '*',
  ].join(' ')
}

/**
 * Validate and normalize a reminder request. Throws {@link ReminderValidationError}
 * with a specific code for each rejection reason so the caller can show the
 * user a precise message.
 *
 * `now` is injectable for tests.
 */
export function validateReminder(
  req: ReminderRequest,
  now: Date = new Date(),
): ValidatedReminder {
  if (typeof req.projectDir !== 'string' || req.projectDir.length === 0) {
    throw new ReminderValidationError(
      'invalid_project',
      'Reminder requires a non-empty projectDir.',
    )
  }

  const text = typeof req.text === 'string' ? req.text.trim() : ''
  if (text.length === 0) {
    throw new ReminderValidationError(
      'empty_text',
      'Reminder text must not be empty.',
    )
  }

  const rawAt = toDate(req.at)
  if (rawAt === null) {
    throw new ReminderValidationError(
      'invalid_time',
      `Could not parse reminder time: ${String(req.at)}`,
    )
  }

  const at = roundUpToMinute(rawAt)
  if (at.getTime() <= now.getTime()) {
    throw new ReminderValidationError(
      'past_time',
      `Reminder time ${at.toISOString()} is not in the future (now ${now.toISOString()}).`,
    )
  }

  const cron = toOneShotCron(at)

  // 5-field cron has no year, so we can only represent a target uniquely
  // within roughly one trip around the calendar. Verify that the cron
  // scheduler, asked "when does this fire next from now", lands on the
  // exact minute we asked for. This catches both >1-year targets (would
  // fire a year early) and Feb-29-in-a-non-leap-year style mismatches.
  const computed = nextCronRunMs(cron, now.getTime())
  if (computed === null || computed !== at.getTime()) {
    throw new ReminderValidationError(
      'unreachable_time',
      `Reminder time ${at.toISOString()} can't be expressed as a one-shot cron from now (nearest fire: ${
        computed === null ? 'never' : new Date(computed).toISOString()
      }). Pick a target within the next year.`,
    )
  }

  return {
    projectDir: req.projectDir,
    text,
    at,
    cron,
  }
}
