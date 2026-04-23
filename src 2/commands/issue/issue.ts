import type { LocalCommandCall } from '../../types/command.js'
import { runIssueCommand } from './workflow.js'

export const call: LocalCommandCall = async args => {
  return {
    type: 'text',
    value: await runIssueCommand(args),
  }
}
