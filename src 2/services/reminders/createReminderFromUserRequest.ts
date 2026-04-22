// User-facing reminder request surface for KAIROS.
//
// This is the integration layer between a user asking "remind me at X to Y"
// and the durable-cron scheduler core from `reminderScheduler.ts` (issue #8).
// It does NOT write cron tasks itself — it only validates, delegates, and
// shapes a result suitable for display back to the user.
//
// Returning a tagged result (`ok: true | false`) instead of throwing lets
// every non-trunk caller render a confirmation or error without needing to
// know about `ReminderValidationError`. The scheduler core still throws on
// I/O failure; those are programmer-visible bugs, not user-visible errors,
// so we deliberately let them propagate.

import {
  type ScheduleReminderResult,
  scheduleReminder,
} from './reminderScheduler.js'
import {
  type ReminderErrorCode,
  type ReminderRequest,
  ReminderValidationError,
} from './reminderValidation.js'

export type UserReminderRequest = ReminderRequest

export type CreateReminderDeps = {
  now?: Date
  /** Injected in tests to assert a stable id in the confirmation result. */
  generateId?: () => string
  /**
   * Injected in tests so the human-readable timestamp in `message` is stable
   * across local timezones. Defaults to a compact local-time format.
   */
  formatTime?: (at: Date) => string
}

export type CreateReminderSuccess = {
  ok: true
  /** `scheduled` — newly written. `duplicate` — equivalent pending task already existed. */
  status: ScheduleReminderResult['status']
  id: string
  at: Date
  text: string
  projectDir: string
  filePath: string
  /** Pre-formatted confirmation the caller can show to the user verbatim. */
  message: string
}

export type CreateReminderFailure = {
  ok: false
  code: ReminderErrorCode
  /** Pre-formatted error the caller can show to the user verbatim. */
  message: string
}

export type CreateReminderResult = CreateReminderSuccess | CreateReminderFailure

function defaultFormatTime(at: Date): string {
  return at.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatValidationMessage(
  err: ReminderValidationError,
  req: UserReminderRequest,
): string {
  switch (err.code) {
    case 'invalid_project':
      return "Can't schedule reminder: no project directory was provided."
    case 'empty_text':
      return "Can't schedule reminder: reminder text is empty."
    case 'invalid_time':
      return `Can't schedule reminder: couldn't parse the time "${String(req.at)}".`
    case 'past_time':
      return "Can't schedule reminder: that time is already in the past. Pick a future time."
    case 'unreachable_time':
      return "Can't schedule reminder: time must be within the next year."
  }
}

/**
 * Validate a user's reminder request, schedule it via the durable-cron core,
 * and return a tagged result containing both machine-readable status and a
 * user-facing `message` ready for display.
 *
 * Never duplicates cron-writing logic — this function is a thin validation +
 * presentation layer over {@link scheduleReminder}.
 */
export async function createReminderFromUserRequest(
  req: UserReminderRequest,
  deps: CreateReminderDeps = {},
): Promise<CreateReminderResult> {
  const formatTime = deps.formatTime ?? defaultFormatTime

  let scheduled: ScheduleReminderResult
  try {
    scheduled = await scheduleReminder(req, {
      now: deps.now,
      generateId: deps.generateId,
    })
  } catch (err) {
    if (err instanceof ReminderValidationError) {
      return {
        ok: false,
        code: err.code,
        message: formatValidationMessage(err, req),
      }
    }
    throw err
  }

  const when = formatTime(scheduled.at)
  const message =
    scheduled.status === 'duplicate'
      ? `Reminder for ${when} already scheduled: "${scheduled.text}". Keeping the existing one.`
      : `Reminder scheduled for ${when}: "${scheduled.text}".`

  return {
    ok: true,
    status: scheduled.status,
    id: scheduled.id,
    at: scheduled.at,
    text: scheduled.text,
    projectDir: scheduled.projectDir,
    filePath: scheduled.filePath,
    message,
  }
}
