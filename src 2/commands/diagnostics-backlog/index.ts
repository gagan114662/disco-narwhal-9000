import type { Command } from '../../commands.js'

const diagnosticsBacklog = {
  type: 'local',
  name: 'diagnostics-backlog',
  description:
    'Summarize IDE diagnostics into grouped, issue-ready backlog entries',
  argumentHint: '[current|snapshot|new]',
  supportsNonInteractive: true,
  load: () => import('./diagnostics-backlog.js'),
} satisfies Command

export default diagnosticsBacklog
