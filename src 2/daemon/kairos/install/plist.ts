// LaunchAgent plist layout for the KAIROS daemon.
//
// We bootstrap the plist into the user's gui domain (not global) so the
// daemon runs under the same uid as the REPL and has access to
// ~/.claude/kairos state out of the box. KeepAlive=true plus a small
// ThrottleInterval means the daemon restarts on crash but not in a tight
// loop.

import { homedir, userInfo } from 'os'
import { join } from 'path'
import {
  getKairosStateDir,
  getKairosStdoutLogPath,
} from '../paths.js'

export const KAIROS_LAUNCH_AGENT_LABEL = 'com.anthropic.claude.kairos'

/**
 * Env vars we refuse to inline into the plist. The claude CLI's auth is
 * Keychain-scoped to the binary; passing ANTHROPIC_API_KEY here would route
 * the daemon around that and leave a secret on disk in cleartext.
 */
export const FORBIDDEN_PLIST_ENV_KEYS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
]

export type KairosPlistInputs = {
  /** Absolute path to the binary that will be executed (e.g. `claude`). */
  program: string
  /** Arguments following the binary path. */
  args: readonly string[]
  /** Extra environment variables to set on the daemon process. */
  env?: Record<string, string>
  /** Working directory for the daemon. Defaults to the user's home. */
  workingDirectory?: string
  /** Stdout log path. Defaults to the kairos state dir daemon log. */
  stdoutPath?: string
  /** Stderr log path. Defaults to kairos state dir. */
  stderrPath?: string
  /** Restart throttle in seconds. Defaults to 10 (matches launchd floor). */
  throttleIntervalSec?: number
  /** Run at load (default true). Set to false for tests. */
  runAtLoad?: boolean
}

/** Path to the user LaunchAgents plist directory. */
export function getLaunchAgentsDir(home: string = homedir()): string {
  return join(home, 'Library', 'LaunchAgents')
}

/** Full path to the kairos LaunchAgent plist file. */
export function getKairosPlistPath(home: string = homedir()): string {
  return join(getLaunchAgentsDir(home), `${KAIROS_LAUNCH_AGENT_LABEL}.plist`)
}

/** `gui/<uid>/<label>` domain target used by launchctl. */
export function getLaunchctlServiceTarget(
  uid: number = userInfo().uid,
): string {
  return `gui/${uid}/${KAIROS_LAUNCH_AGENT_LABEL}`
}

// The plist format is a small, well-defined subset — escape text nodes and
// emit XML ourselves so the installer has no runtime plist dependency.
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function stringElement(value: string, indent: string): string {
  return `${indent}<string>${escapeXml(value)}</string>`
}

function arrayElement(values: readonly string[], indent: string): string {
  const inner = values
    .map(v => stringElement(v, `${indent}  `))
    .join('\n')
  return `${indent}<array>\n${inner}\n${indent}</array>`
}

function dictElement(
  entries: Array<[string, string]>,
  indent: string,
): string {
  if (entries.length === 0) return `${indent}<dict/>`
  const inner = entries
    .flatMap(([k, v]) => [
      `${indent}  <key>${escapeXml(k)}</key>`,
      stringElement(v, `${indent}  `),
    ])
    .join('\n')
  return `${indent}<dict>\n${inner}\n${indent}</dict>`
}

/**
 * Default environment the daemon must inherit when launchd starts it.
 * HOME + USER matter for macOS Keychain: the claude CLI's ACL is scoped to
 * the user's Keychain, and SDK code downstream of `query()` resolves config
 * under `$HOME/.claude`. launchd strips most of the parent env when a
 * LaunchAgent boots, so we pin these here.
 */
export function buildDefaultPlistEnv(
  overrides: Partial<{ home: string; user: string; path: string }> = {},
): Record<string, string> {
  const info = userInfo()
  const home = overrides.home ?? info.homedir
  const user = overrides.user ?? info.username
  const path =
    overrides.path ??
    process.env.PATH ??
    '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
  return { HOME: home, USER: user, PATH: path }
}

/**
 * Merge a default env with user overrides, filtering out forbidden keys
 * (like ANTHROPIC_API_KEY) so they can never leak onto disk via the plist.
 */
export function sanitizePlistEnv(
  env: Record<string, string>,
): Record<string, string> {
  const forbidden = new Set(FORBIDDEN_PLIST_ENV_KEYS)
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (forbidden.has(key)) continue
    out[key] = value
  }
  return out
}

export function buildKairosPlist(inputs: KairosPlistInputs): string {
  const runAtLoad = inputs.runAtLoad ?? true
  const throttle = inputs.throttleIntervalSec ?? 10
  const workingDir = inputs.workingDirectory ?? homedir()
  const stdoutPath = inputs.stdoutPath ?? getKairosStdoutLogPath()
  const stderrPath =
    inputs.stderrPath ?? join(getKairosStateDir(), 'daemon.err.log')
  const programArgs = [inputs.program, ...inputs.args]
  const mergedEnv = sanitizePlistEnv({
    ...buildDefaultPlistEnv(),
    ...(inputs.env ?? {}),
  })
  const envEntries = Object.entries(mergedEnv)

  const body: string[] = [
    '    <key>Label</key>',
    stringElement(KAIROS_LAUNCH_AGENT_LABEL, '    '),
    '    <key>ProgramArguments</key>',
    arrayElement(programArgs, '    '),
    '    <key>RunAtLoad</key>',
    runAtLoad ? '    <true/>' : '    <false/>',
    '    <key>KeepAlive</key>',
    '    <true/>',
    '    <key>ThrottleInterval</key>',
    `    <integer>${Math.max(1, Math.floor(throttle))}</integer>`,
    '    <key>WorkingDirectory</key>',
    stringElement(workingDir, '    '),
    '    <key>StandardOutPath</key>',
    stringElement(stdoutPath, '    '),
    '    <key>StandardErrorPath</key>',
    stringElement(stderrPath, '    '),
    // Keychain ACLs are scoped to the Aqua (GUI) session — pin this so
    // launchd doesn't try to start the agent in a background/ssh session
    // where the Keychain is locked.
    '    <key>LimitLoadToSessionType</key>',
    stringElement('Aqua', '    '),
  ]
  // envEntries always has HOME/USER/PATH from the default merge above, so
  // this block is effectively always emitted — the conditional is defense
  // in depth for future callers who opt out explicitly.
  if (envEntries.length > 0) {
    body.push('    <key>EnvironmentVariables</key>')
    body.push(dictElement(envEntries, '    '))
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
      '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '  <dict>',
    ...body,
    '  </dict>',
    '</plist>',
    '',
  ].join('\n')
}
