import { getBrowserHarnessCommandDisplayName, resolveBrowserHarnessCommand } from '../../utils/browserHarness.js'
import { registerBundledSkill } from '../bundledSkills.js'
import {
  BROWSER_HARNESS_SKILL_BODY,
  BROWSER_HARNESS_SKILL_FILES,
} from './browserHarnessContent.js'

const DESCRIPTION =
  'Uses an explicitly enabled Browser Harness install for real browser work against the user\'s local browser. Best for logged-in flows, uploads, OAuth, and dynamic UI tasks that normal web tools cannot reliably handle.'

export function registerBrowserHarnessSkill(): void {
  registerBundledSkill({
    name: 'browser-harness',
    description: DESCRIPTION,
    allowedTools: ['Bash', 'Read', 'Grep', 'Glob', 'Edit', 'Write'],
    userInvocable: true,
    files: BROWSER_HARNESS_SKILL_FILES,
    async getPromptForCommand(args) {
      const resolvedCommand = await resolveBrowserHarnessCommand()
      const expectedCommand = getBrowserHarnessCommandDisplayName()

      const runtimeStatus = resolvedCommand
        ? `## Runtime status

Browser Harness opt-in is enabled for this session.

- Resolved executable: \`${resolvedCommand}\`
- Integration mode: explicit and optional
- Default behavior: unchanged unless you deliberately use this skill
`
        : `## Runtime status

Browser Harness opt-in is enabled for this session, but the executable is not currently available.

- Expected executable: \`${expectedCommand}\`
- Action: do not claim browser control is active
- Next step: follow \`setup.md\` and explain the missing setup clearly if the user asked for a real-browser task
`

      const parts = [runtimeStatus.trim(), BROWSER_HARNESS_SKILL_BODY]
      if (args) {
        parts.push(`## User request\n\n${args}`)
      }

      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
