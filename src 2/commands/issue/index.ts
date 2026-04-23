import type { Command } from '../../commands.js'

const issue = {
  type: 'local',
  name: 'issue',
  description: 'Generate a structured GitHub issue draft',
  argumentHint: '[requirement|design|work-order|bug] <title>',
  supportsNonInteractive: true,
  load: () => import('./issue.js'),
} satisfies Command

export default issue
