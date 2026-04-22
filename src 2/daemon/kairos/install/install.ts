// Install the KAIROS LaunchAgent plist and bootstrap it via launchctl.
//
// Resolves the claude binary by walking up from the currently-running script:
//   - If we're running through `bun` (dev mode), the program is `bun` and the
//     first arg is the absolute path to the cli entrypoint.
//   - If we're running the bundled `./dist/cli.js`, program is the node/bun
//     runtime and the arg is the bundled file.
// Either way, we capture process.execPath + argv[1] (the entrypoint) so the
// LaunchAgent starts the same binary the user invoked, even without a
// globally-installed `claude`.
//
// Usage from the workspace root:
//   bun run ./daemon/kairos/install/install.ts
// or programmatically: `await installKairosLaunchAgent()`.

import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { promisify } from 'util'
import { execFile as execFileCb } from 'child_process'
import { userInfo } from 'os'
import {
  buildKairosPlist,
  getKairosPlistPath,
  getLaunchctlServiceTarget,
  KAIROS_LAUNCH_AGENT_LABEL,
  type KairosPlistInputs,
} from './plist.js'

const execFile = promisify(execFileCb)

/**
 * Find the canonical `claude` CLI binary — the same one the user runs
 * interactively, so launchd uses a Keychain ACL path we know is authorized.
 * Resolution order:
 *   1. CLAUDE_BIN env override (explicit user intent).
 *   2. `which claude` from PATH (the normal install case).
 *   3. process.execPath + argv[1] (dev fallback: whatever is running this
 *      script right now, e.g. `bun ./entrypoints/cli.tsx`).
 */
export async function resolveCanonicalClaude(
  overrides: {
    env?: NodeJS.ProcessEnv
    which?: (name: string) => Promise<string | null>
  } = {},
): Promise<{ program: string; args: string[] }> {
  const env = overrides.env ?? process.env
  const envOverride = env.CLAUDE_BIN?.trim()
  if (envOverride) {
    return { program: envOverride, args: ['daemon', 'kairos'] }
  }
  const whichFn = overrides.which ?? defaultWhich
  const fromPath = await whichFn('claude')
  if (fromPath) {
    return { program: fromPath, args: ['daemon', 'kairos'] }
  }
  // Last-resort dev fallback: whatever runtime/entrypoint is currently
  // executing the installer. When the user invoked `claude daemon install`
  // through a bundled binary, this is the same canonical binary.
  const program = process.execPath
  const entry = process.argv[1]
  return {
    program,
    args: entry ? [entry, 'daemon', 'kairos'] : ['daemon', 'kairos'],
  }
}

async function defaultWhich(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('/usr/bin/which', [name])
    const trimmed = stdout.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

export type LaunchctlRunner = (
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>

const defaultRunner: LaunchctlRunner = async args => {
  const { stdout, stderr } = await execFile('launchctl', [...args])
  return { stdout, stderr }
}

export type InstallKairosOptions = {
  /** Path where the plist should be written. Defaults to the user LaunchAgents dir. */
  plistPath?: string
  /** Override the program arguments written into the plist. */
  plistInputs?: Partial<KairosPlistInputs>
  /** Uid for the gui domain target. Defaults to the current user. */
  uid?: number
  /** Swap out the real launchctl for tests. */
  launchctl?: LaunchctlRunner
}

export async function installKairosLaunchAgent(
  options: InstallKairosOptions = {},
): Promise<{ plistPath: string; target: string; program: string }> {
  const plistPath = options.plistPath ?? getKairosPlistPath()
  const uid = options.uid ?? userInfo().uid
  const runner = options.launchctl ?? defaultRunner
  const target = getLaunchctlServiceTarget(uid)

  const defaults = await resolveCanonicalClaude()
  const inputs: KairosPlistInputs = {
    program: options.plistInputs?.program ?? defaults.program,
    args: options.plistInputs?.args ?? defaults.args,
    env: options.plistInputs?.env,
    workingDirectory: options.plistInputs?.workingDirectory,
    stdoutPath: options.plistInputs?.stdoutPath,
    stderrPath: options.plistInputs?.stderrPath,
    throttleIntervalSec: options.plistInputs?.throttleIntervalSec,
    runAtLoad: options.plistInputs?.runAtLoad,
  }

  await mkdir(dirname(plistPath), { recursive: true })
  await writeFile(plistPath, buildKairosPlist(inputs), 'utf8')

  // Bootout any existing instance first so re-installs are idempotent.
  // launchctl returns non-zero when the service isn't loaded yet — swallow
  // that single class of error and propagate anything else.
  try {
    await runner(['bootout', target])
  } catch {
    // expected on first install
  }
  await runner(['bootstrap', `gui/${uid}`, plistPath])
  await runner(['enable', target])

  return { plistPath, target, program: inputs.program }
}

// CLI entrypoint — only run when this file is executed directly.
const isMainModule =
  typeof process !== 'undefined' &&
  typeof import.meta !== 'undefined' &&
  typeof import.meta.url === 'string' &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  installKairosLaunchAgent()
    .then(({ plistPath, target, program }) => {
      console.log(`Installed ${KAIROS_LAUNCH_AGENT_LABEL}`)
      console.log(`  plist:   ${plistPath}`)
      console.log(`  target:  ${target}`)
      console.log(`  program: ${program}`)
      console.log('')
      console.log(
        'Note: KAIROS runs as a LaunchAgent. The daemon only ticks while',
      )
      console.log(
        'you are logged into your Mac (locked screen is fine, logout is not).',
      )
      console.log(
        'If macOS later re-prompts for Keychain access after a Claude Code',
      )
      console.log(
        'update, run `claude` interactively once to re-authorize the binary.',
      )
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`kairos install failed: ${message}`)
      process.exit(1)
    })
}
