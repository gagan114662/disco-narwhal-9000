import type { Command } from '../../commands.js'

const remind = {
  type: 'local',
  name: 'remind',
  description: 'Schedule a reminder for a future time',
  argumentHint: '<time> | <text>',
  supportsNonInteractive: true,
  load: () => import('./remind.js'),
} satisfies Command

export default remind
