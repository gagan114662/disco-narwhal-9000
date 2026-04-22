import { constants as fsConstants } from 'fs'
import { access } from 'fs/promises'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { which } from './which.js'

export const BROWSER_HARNESS_ENABLE_ENV =
  'CLAUDE_CODE_ENABLE_BROWSER_HARNESS'
export const BROWSER_HARNESS_PATH_ENV = 'CLAUDE_CODE_BROWSER_HARNESS_PATH'

const DEFAULT_BROWSER_HARNESS_COMMAND = 'browser-harness'

export const BROWSER_HARNESS_SKILL_HINT = `**Real Browser Tasks**: Browser Harness is an explicitly enabled integration for the user's real local browser. Use normal web tools by default. When the task needs login state, uploads, OAuth, or a messy real-world UI flow, invoke Skill(skill: "browser-harness") first so you can confirm setup and then use Browser Harness deliberately.`

export function shouldEnableBrowserHarness(): boolean {
  if (isEnvTruthy(process.env[BROWSER_HARNESS_ENABLE_ENV])) {
    return true
  }
  if (isEnvDefinedFalsy(process.env[BROWSER_HARNESS_ENABLE_ENV])) {
    return false
  }
  return false
}

export function getBrowserHarnessCommandDisplayName(): string {
  return process.env[BROWSER_HARNESS_PATH_ENV]?.trim() || DEFAULT_BROWSER_HARNESS_COMMAND
}

export async function resolveBrowserHarnessCommand(): Promise<string | null> {
  const explicitPath = process.env[BROWSER_HARNESS_PATH_ENV]?.trim()
  if (explicitPath) {
    return (await isExecutableFile(explicitPath)) ? explicitPath : null
  }

  return which(DEFAULT_BROWSER_HARNESS_COMMAND)
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}
