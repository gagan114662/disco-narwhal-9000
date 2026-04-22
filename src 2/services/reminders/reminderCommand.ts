import { getProjectRoot } from '../../bootstrap/state.js'
import {
  createReminderFromUserRequest,
  type CreateReminderDeps,
} from './createReminderFromUserRequest.js'

export const REMINDER_COMMAND_HELP_TEXT = `Usage:
/remind <time> | <text>

Examples:
/remind 2026-05-15 14:02 | Drink water.
/remind in 2 hours | Check the deploy.`

export function parseReminderCommandArgs(
  args: string,
): { at: string; text: string } | null {
  const trimmed = args.trim()
  if (trimmed.length === 0) return null

  const splitAt = trimmed.indexOf('|')
  if (splitAt === -1) return null

  const at = trimmed.slice(0, splitAt).trim()
  const text = trimmed.slice(splitAt + 1).trim()

  if (at.length === 0 || text.length === 0) {
    return null
  }

  return { at, text }
}

export async function runReminderCommand(
  args: string,
  deps: CreateReminderDeps & { projectDir?: string } = {},
): Promise<string> {
  const parsed = parseReminderCommandArgs(args)
  if (!parsed) {
    return REMINDER_COMMAND_HELP_TEXT
  }

  const result = await createReminderFromUserRequest(
    {
      projectDir: deps.projectDir ?? getProjectRoot(),
      text: parsed.text,
      at: parsed.at,
    },
    deps,
  )

  return result.message
}
