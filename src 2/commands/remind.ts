import { feature } from 'bun:bundle'
import type { Command } from '../commands.js'
import { getProjectRoot } from '../bootstrap/state.js'
import {
  createReminderFromUserRequest,
  type CreateReminderDeps,
} from '../services/reminders/createReminderFromUserRequest.js'
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../types/command.js'

const HELP_TEXT = `Usage:
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

export async function runRemindCommand(
  args: string,
  deps: CreateReminderDeps & { projectDir?: string } = {},
): Promise<string> {
  const parsed = parseReminderCommandArgs(args)
  if (!parsed) {
    return HELP_TEXT
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

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
  args: string,
): Promise<undefined> {
  onDone(await runRemindCommand(args), { display: 'system' })
}

const remind = {
  type: 'local-jsx',
  name: 'remind',
  aliases: ['reminder'],
  description: 'Create a durable reminder for this project',
  argumentHint: '<time> | <text>',
  isEnabled: () => (feature('KAIROS') ? true : false),
  load: () => Promise.resolve({ call }),
} satisfies Command

export default remind
