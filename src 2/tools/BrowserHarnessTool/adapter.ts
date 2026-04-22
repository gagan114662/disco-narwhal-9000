import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import { whichSync } from '../../utils/which.js'

export const DEFAULT_BROWSER_HARNESS_COMMAND = 'browser-harness'
export const DEFAULT_BROWSER_HARNESS_TIMEOUT_MS = 5 * 60 * 1000

export type BrowserHarnessSettings = {
  enabled?: boolean
  command?: string
  env?: Record<string, string>
  timeoutMs?: number
}

type SettingsShape = {
  browserHarness?: BrowserHarnessSettings
}

export type BrowserHarnessExecResult = {
  stdout: string
  stderr: string
  code: number
  error?: string
}

export type BrowserHarnessDependencies = {
  getSettings?: () => SettingsShape
  whichSync?: (cmd: string) => string | null
  execFileNoThrow?: (
    file: string,
    args: string[],
    options: {
      useCwd?: boolean
      timeout?: number
      stdin?: 'pipe' | 'ignore' | 'inherit'
      input?: string
      env?: NodeJS.ProcessEnv
      preserveOutputOnError?: boolean
    },
  ) => Promise<BrowserHarnessExecResult>
}

export type BrowserHarnessRunInput = {
  script: string
  timeoutMs?: number
}

export type BrowserHarnessRunResult = {
  success: boolean
  exitCode: number
  stdout: string
  stderr: string
  command: string
  durationMs: number
  error?: string
}

export class BrowserHarnessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrowserHarnessError'
  }
}

function readSettings(deps: BrowserHarnessDependencies): SettingsShape {
  const getter = deps.getSettings ?? getSettings_DEPRECATED
  return (getter() || {}) as SettingsShape
}

export function getBrowserHarnessSettings(
  deps: BrowserHarnessDependencies = {},
): BrowserHarnessSettings {
  const settings = readSettings(deps).browserHarness
  if (!settings?.enabled) {
    throw new BrowserHarnessError(
      'Browser Harness integration is not enabled. Set `browserHarness.enabled` to `true` in your settings after installing https://github.com/browser-use/browser-harness.',
    )
  }
  return settings
}

export function resolveBrowserHarnessCommand(
  settings: BrowserHarnessSettings,
  deps: BrowserHarnessDependencies = {},
): string {
  const command = settings.command?.trim() || DEFAULT_BROWSER_HARNESS_COMMAND
  const whichImpl = deps.whichSync ?? whichSync
  const resolved = whichImpl(command)
  if (!resolved) {
    throw new BrowserHarnessError(
      `Could not find the \`${command}\` executable on PATH. Install Browser Harness with \`uv tool install -e .\` inside a clone of https://github.com/browser-use/browser-harness, or set \`browserHarness.command\` to the absolute path of your installed binary.`,
    )
  }
  return resolved
}

function buildEnv(
  extra: Record<string, string> | undefined,
): NodeJS.ProcessEnv | undefined {
  if (!extra || Object.keys(extra).length === 0) {
    return undefined
  }
  return { ...process.env, ...extra }
}

export async function runBrowserHarnessScript(
  input: BrowserHarnessRunInput,
  deps: BrowserHarnessDependencies = {},
): Promise<BrowserHarnessRunResult> {
  const script = input.script
  if (typeof script !== 'string' || script.trim() === '') {
    throw new BrowserHarnessError(
      '`script` must be a non-empty Python payload for browser-harness.',
    )
  }

  const settings = getBrowserHarnessSettings(deps)
  const resolvedCommand = resolveBrowserHarnessCommand(settings, deps)
  const timeout =
    input.timeoutMs ?? settings.timeoutMs ?? DEFAULT_BROWSER_HARNESS_TIMEOUT_MS
  const execImpl = deps.execFileNoThrow ?? execFileNoThrow

  const startedAt = Date.now()
  const result = await execImpl(resolvedCommand, [], {
    useCwd: false,
    timeout,
    stdin: 'pipe',
    input: script,
    env: buildEnv(settings.env),
    preserveOutputOnError: true,
  })
  const durationMs = Date.now() - startedAt

  const success = result.code === 0 && !result.error
  return {
    success,
    exitCode: result.code,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    command: resolvedCommand,
    durationMs,
    error: success
      ? undefined
      : result.error ||
        `browser-harness exited with code ${result.code}. stderr: ${
          result.stderr?.trim() || '(empty)'
        }`,
  }
}
