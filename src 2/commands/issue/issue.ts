import type { LocalCommandCall } from '../../types/command.js'
import {
  buildIssueScaffold,
  getIssueCommandHelp,
  parseIssueCommandArgs,
} from './scaffold.js'

export const call: LocalCommandCall = async args => {
  const trimmedArgs = args.trim()

  if (trimmedArgs === 'help' || trimmedArgs === '--help' || trimmedArgs === '-h') {
    return {
      type: 'text',
      value: getIssueCommandHelp(),
    }
  }

  const parsed = parseIssueCommandArgs(trimmedArgs)
  if (!parsed) {
    return {
      type: 'text',
      value: `${getIssueCommandHelp()}\n\nInvalid issue type. Use one of: requirement, design, work-order, bug.`,
    }
  }

  const scaffold = buildIssueScaffold(parsed)
  const intro = parsed.usedPlaceholderTitle
    ? 'Generated a draft with a placeholder title. Pass a title to prefill it.\n\n'
    : ''

  return {
    type: 'text',
    value: `${intro}${scaffold}`,
  }
}
