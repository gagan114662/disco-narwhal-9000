import type { LocalCommandCall } from '../../types/command.js'
import { runReminderCommand } from '../../services/reminders/reminderCommand.js'

export const call: LocalCommandCall = async args => {
  const value = await runReminderCommand(args)
  return { type: 'text', value }
}
