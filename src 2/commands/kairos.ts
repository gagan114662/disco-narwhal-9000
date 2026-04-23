// /kairos — user-facing control surface for the KAIROS daemon.
//
// All file layout lives in daemon/kairos/paths.ts; this command just routes
// subcommands to the same model functions the dashboard uses, so terminal
// and browser UIs stay in sync through the on-disk state (not a shared
// in-memory singleton).
//
// Scope — this file intentionally does NOT register itself in commands.ts.
// Trunk registration is Phase 5B (see epic #11).

import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { getProjectRoot } from '../bootstrap/state.js'
import type { Command } from '../types/command.js'
import {
  runKairosMemoryCommand,
  runKairosMemoryProposalsCommand,
} from './kairos-memory-proposals.js'
import { runKairosSkillsInteropCommand } from './kairos-skills-interop.js'
import { runSkillImprovementsCommand } from './kairos-skill-improvements.js'
import {
  enqueueDemoTask,
  optInProject,
  optOutProject,
  setPauseState,
} from '../daemon/dashboard/model.js'
import { createProjectRegistry } from '../daemon/kairos/projectRegistry.js'
import {
  getKairosPausePath,
  getKairosStatusPath,
  getKairosStdoutLogPath,
  getProjectKairosLogPath,
} from '../daemon/kairos/paths.js'
import {
  readGatewayStatus,
  setupTelegram,
  startPairing,
  unpairTelegram,
} from '../daemon/gateway/telegram/cli.js'
import {
  applyKairosCloudStateBundle,
  buildKairosCloudStateBundle,
  type ApplyKairosCloudStateBundleResult,
  type KairosCloudStateBundle,
} from '../daemon/kairos/cloudSync.js'
import { runKairosCloudLifecycleCommand } from '../daemon/kairos/cloudLifecycle.js'
import { safeParseJSON } from '../utils/json.js'
import type { GlobalStatus, PauseState } from '../daemon/kairos/stateWriter.js'

const DEFAULT_DASHBOARD_URL = 'http://127.0.0.1:7777/'
const DEFAULT_LOG_TAIL = 25

const HELP_TEXT = `Usage:
/kairos status
/kairos list
/kairos opt-in [projectDir]
/kairos opt-out [projectDir]
/kairos demo [projectDir]
/kairos pause
/kairos resume
/kairos dashboard
/kairos logs [projectDir] [lines]
/kairos cloud deploy --ssh-host <user@host> [--use-subscription | --anthropic-api-key-env <ENV_NAME>]
/kairos cloud upgrade [--ssh-host <user@host>] [--use-subscription | --anthropic-api-key-env <ENV_NAME>]
/kairos cloud destroy [--ssh-host <user@host>] --confirm
/kairos cloud-sync <runtimeRoot>
/kairos gateway telegram setup <bot-token>
/kairos gateway telegram pair
/kairos gateway telegram status
/kairos gateway telegram unpair [chatId|all]
/kairos skills lint <path|skill-name|manifest-json>
/kairos skills import <url|path|manifest-json> [--yes] [--overwrite]
/kairos skills export <path|skill-name> [--publish]
/kairos skill-improvements list|diff|accept|reject [id]
/kairos memory-proposals list|diff|accept|reject
/kairos memory wipe --confirm`

type Subcommand =
  | 'status'
  | 'list'
  | 'opt-in'
  | 'opt-out'
  | 'demo'
  | 'pause'
  | 'resume'
  | 'dashboard'
  | 'logs'
  | 'cloud'
  | 'cloud-sync'
  | 'gateway'
  | 'skills'
  | 'skill-improvements'
  | 'memory-proposals'
  | 'memory'

const SUBCOMMANDS = new Set<Subcommand>([
  'status',
  'list',
  'opt-in',
  'opt-out',
  'demo',
  'pause',
  'resume',
  'dashboard',
  'logs',
  'cloud',
  'cloud-sync',
  'gateway',
  'skills',
  'skill-improvements',
  'memory-proposals',
  'memory',
])

function parseArgs(args: string): { sub: Subcommand | null; rest: string[] } {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { sub: null, rest: [] }
  const [head, ...rest] = tokens
  if (!SUBCOMMANDS.has(head as Subcommand)) {
    return { sub: null, rest: tokens }
  }
  return { sub: head as Subcommand, rest }
}

function resolveProjectDir(explicit: string | undefined): string {
  if (explicit && explicit.trim().length > 0) return explicit
  return getProjectRoot()
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = safeParseJSON(raw, false)
    return parsed === null ? null : (parsed as T)
  } catch {
    return null
  }
}

async function handleStatus(): Promise<string> {
  const [status, pause, registry] = await Promise.all([
    readJsonIfExists<GlobalStatus>(getKairosStatusPath()),
    readJsonIfExists<PauseState>(getKairosPausePath()),
    createProjectRegistry(),
  ])
  const projects = await registry.read()
  const lines: string[] = []
  if (status) {
    lines.push(`daemon: ${status.state} (pid ${status.pid})`)
    lines.push(`started: ${status.startedAt}`)
    lines.push(`updated: ${status.updatedAt}`)
  } else {
    lines.push('daemon: not running (no status file)')
  }
  if (pause?.paused) {
    const reason = pause.reason ? ` [${pause.reason}]` : ''
    const scope = pause.scope ? ` scope=${pause.scope}` : ''
    lines.push(`paused: yes${reason}${scope}`)
    if (pause.notice) {
      lines.push(`notice: ${pause.notice}`)
    }
  } else {
    lines.push('paused: no')
  }
  lines.push(`projects: ${projects.length}`)
  return lines.join('\n')
}

async function handleList(): Promise<string> {
  const registry = await createProjectRegistry()
  const projects = await registry.read()
  if (projects.length === 0) {
    return 'No projects opted in.'
  }
  return projects.map(p => `- ${p}`).join('\n')
}

async function handleOptIn(projectDir: string): Promise<string> {
  await optInProject(projectDir)
  return `Opted in: ${projectDir}`
}

async function handleOptOut(projectDir: string): Promise<string> {
  await optOutProject(projectDir)
  return `Opted out: ${projectDir}`
}

async function handleDemo(projectDir: string): Promise<string> {
  const taskId = await enqueueDemoTask(projectDir)
  return `Demo task ${taskId} scheduled in ${projectDir}/.claude/scheduled_tasks.json`
}

async function handlePause(): Promise<string> {
  await setPauseState(true)
  return 'Paused KAIROS daemon. Fired tasks will be skipped until resume.'
}

async function handleResume(): Promise<string> {
  const previous = await readJsonIfExists<PauseState>(getKairosPausePath())
  await setPauseState(false)
  if (previous?.paused && previous.reason === 'auth_failure') {
    return (
      'Resumed KAIROS daemon. NOTE: previous pause was auth_failure — if ' +
      'you have not run `claude` interactively to re-authorize the ' +
      'Keychain entry, the next fired task will auth-fail again.'
    )
  }
  return 'Resumed KAIROS daemon.'
}

function handleDashboard(): string {
  const url = process.env.KAIROS_DASHBOARD_URL ?? DEFAULT_DASHBOARD_URL
  return `Dashboard: ${url}`
}

async function tailFile(path: string, n: number): Promise<string[]> {
  try {
    const raw = await readFile(path, 'utf8')
    return raw.trim().split('\n').filter(Boolean).slice(-n)
  } catch {
    return []
  }
}

async function handleLogs(
  projectDir: string | undefined,
  linesArg: string | undefined,
): Promise<string> {
  const n = linesArg ? Math.max(1, Math.floor(Number(linesArg))) : DEFAULT_LOG_TAIL
  const limit = Number.isFinite(n) ? n : DEFAULT_LOG_TAIL

  if (projectDir) {
    const tail = await tailFile(getProjectKairosLogPath(projectDir), limit)
    if (tail.length === 0) {
      return `No project log at ${getProjectKairosLogPath(projectDir)}.`
    }
    return tail.join('\n')
  }
  const tail = await tailFile(getKairosStdoutLogPath(), limit)
  if (tail.length === 0) {
    return `No daemon log at ${getKairosStdoutLogPath()}.`
  }
  return tail.join('\n')
}

async function handleGatewayTelegram(args: string[]): Promise<string> {
  const [action, ...rest] = args
  if (!action) {
    return 'Usage: /kairos gateway telegram <setup|pair|status|unpair> [...]'
  }
  switch (action) {
    case 'setup': {
      const token = rest.join(' ').trim()
      if (!token) return 'Usage: /kairos gateway telegram setup <bot-token>'
      const result = await setupTelegram(token)
      if (!result.ok) return `Setup failed: ${result.reason}`
      const who = result.botUsername ? ` as @${result.botUsername}` : ''
      return `Telegram gateway configured${who}. Now run \`/kairos gateway telegram pair\` to link your chat.`
    }
    case 'pair': {
      const result = await startPairing()
      if (!result.ok) return result.reason
      const who = result.botUsername ? `@${result.botUsername}` : 'your bot'
      return [
        `Pair code: ${result.code}`,
        `On your phone, open Telegram, DM ${who}, and send the code above.`,
        'The code expires in 15 minutes.',
      ].join('\n')
    }
    case 'status': {
      const s = await readGatewayStatus()
      if (!s.configured) {
        return `Telegram gateway: not configured (${s.configPath} missing). Run \`/kairos gateway telegram setup <bot-token>\` to start.`
      }
      const who = s.botUsername ? `@${s.botUsername}` : '(unknown username)'
      const paired = s.pairedChatIds.length === 0 ? 'none' : s.pairedChatIds.join(', ')
      return `Telegram gateway: bot=${who}, paired chat IDs=${paired}`
    }
    case 'unpair': {
      const target = rest[0]
      if (!target || target === 'all') {
        const r = await unpairTelegram('all')
        if (!r.ok) return r.reason
        return `Unpaired ${r.removed.length} chat(s). Allowlist cleared.`
      }
      const chatId = Number(target)
      if (!Number.isInteger(chatId)) return `Not a numeric chat id: ${target}`
      const r = await unpairTelegram(chatId)
      if (!r.ok) return r.reason
      return `Unpaired chat ${chatId}. Remaining: ${r.remaining.join(', ') || 'none'}`
    }
    default:
      return `Unknown gateway telegram action: ${action}`
  }
}

async function handleGateway(rest: string[]): Promise<string> {
  const [channel, ...args] = rest
  if (channel === 'telegram') return handleGatewayTelegram(args)
  return 'Usage: /kairos gateway telegram <setup|pair|status|unpair> [...]'
}

type KairosCloudSyncDeps = {
  buildBundle: () => Promise<KairosCloudStateBundle>
  applyBundle: (
    bundle: KairosCloudStateBundle,
    options: { runtimeRoot: string },
  ) => Promise<ApplyKairosCloudStateBundleResult>
}

let kairosCloudSyncDeps: KairosCloudSyncDeps = {
  buildBundle: () => buildKairosCloudStateBundle(),
  applyBundle: (bundle, options) =>
    applyKairosCloudStateBundle(bundle, options),
}

export function __setKairosCloudSyncDepsForTesting(
  deps: KairosCloudSyncDeps,
): void {
  kairosCloudSyncDeps = deps
}

export function __resetKairosCloudSyncDepsForTesting(): void {
  kairosCloudSyncDeps = {
    buildBundle: () => buildKairosCloudStateBundle(),
    applyBundle: (bundle, options) =>
      applyKairosCloudStateBundle(bundle, options),
  }
}

async function handleCloudSync(runtimeRootArg: string | undefined): Promise<string> {
  if (!runtimeRootArg || runtimeRootArg.trim().length === 0) {
    return 'Usage: /kairos cloud-sync <runtimeRoot>'
  }

  const runtimeRoot = resolve(runtimeRootArg)
  try {
    const bundle = await kairosCloudSyncDeps.buildBundle()
    const result = await kairosCloudSyncDeps.applyBundle(bundle, { runtimeRoot })
    return [
      `Cloud sync applied: ${bundle.files.length} file(s), ${bundle.projects.length} project(s)`,
      `runtime root: ${runtimeRoot}`,
      `source: ${result.sourceDir}`,
      `overlay: ${result.overlayDir}`,
      `manifest: ${result.manifestPath}`,
      `registry: ${result.registryPath}`,
    ].join('\n')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return `Cloud sync failed: ${message}`
  }
}

async function handleCloud(rest: string[]): Promise<string> {
  return runKairosCloudLifecycleCommand(rest)
}

export async function runKairosCommand(args: string): Promise<string> {
  const { sub, rest } = parseArgs(args)
  if (sub === null) {
    return HELP_TEXT
  }
  switch (sub) {
    case 'status':
      return handleStatus()
    case 'list':
      return handleList()
    case 'opt-in':
      return handleOptIn(resolveProjectDir(rest[0]))
    case 'opt-out':
      return handleOptOut(resolveProjectDir(rest[0]))
    case 'demo':
      return handleDemo(resolveProjectDir(rest[0]))
    case 'pause':
      return handlePause()
    case 'resume':
      return handleResume()
    case 'dashboard':
      return handleDashboard()
    case 'cloud':
      return handleCloud(rest)
    case 'cloud-sync':
      return handleCloudSync(rest.join(' ').trim() || undefined)
    case 'gateway':
      return handleGateway(rest)
    case 'logs': {
      const first = rest[0]
      // A bare number is always a line count; anything else (including
      // `.`, `./foo`, or a bare project name) is a project dir. Avoids
      // the earlier heuristic's false-positive on tokens like `25.`.
      const firstIsLineCount = first !== undefined && /^\d+$/.test(first)
      if (first !== undefined && !firstIsLineCount) {
        return handleLogs(resolveProjectDir(first), rest[1])
      }
      return handleLogs(undefined, first)
    }
    case 'skills':
      return runKairosSkillsInteropCommand(
        args.trim().slice('skills'.length).trim(),
      )
    case 'skill-improvements':
      return runSkillImprovementsCommand(rest)
    case 'memory-proposals':
      return runKairosMemoryProposalsCommand(rest)
    case 'memory':
      return runKairosMemoryCommand(rest)
  }
}

const kairos = {
  type: 'local-jsx',
  name: 'kairos',
  description: 'Inspect and control the KAIROS background daemon',
  argumentHint:
    'status|list|opt-in|opt-out|demo|pause|resume|dashboard|logs|cloud|cloud-sync|gateway|skills|skill-improvements|memory-proposals|memory',
  load: () => import('./kairos-ui.js'),
} satisfies Command

export default kairos
