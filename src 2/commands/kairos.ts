// /kairos — user-facing control surface for the KAIROS daemon.
//
// All file layout lives in daemon/kairos/paths.ts; this command just routes
// subcommands to the same model functions the dashboard uses, so terminal
// and browser UIs stay in sync through the on-disk state (not a shared
// in-memory singleton).
//
// Scope — this command is also routed directly from entrypoints/cli.tsx so
// production `claude kairos ...` works even when upstream feature flags would
// skip slash-command registration.

import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { getProjectRoot } from '../bootstrap/state.js'
import type { Command } from '../types/command.js'
import {
  acceptSoftwareFactoryChange,
  acceptSoftwareFactoryReconciliation,
  exportSoftwareFactoryCompliancePack,
  listSoftwareFactoryBuilds,
  proposeSoftwareFactoryChange,
  proposeSoftwareFactoryReconciliation,
  readSoftwareFactoryBuild,
  runSoftwareFactoryBuild,
  scanSoftwareFactoryTraceability,
  verifySoftwareFactoryBuild,
} from '../daemon/kairos/softwareFactory.js'
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
  readDashboardSnapshot,
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
/kairos build run [projectDir] <brief>
/kairos build list
/kairos build show <buildId>
/kairos build verify <buildId>
/kairos build change <buildId> <change>
/kairos build accept-change <buildId>
/kairos build scan <buildId>
/kairos build reconcile <buildId>
/kairos build accept-reconciliation <buildId>
/kairos build export <buildId>
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
  | 'build'
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
  'build',
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

function formatCurrency(value: number | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return `$${value.toFixed(4)}`
}

function formatOptionalValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '—'
  }
  return String(value)
}

async function handleStatus(): Promise<string> {
  const snapshot = await readDashboardSnapshot()
  const { status, pause, costs, projects } = snapshot.global
  const lines: string[] = []
  if (status) {
    lines.push(`daemon: ${status.state} (pid ${status.pid})`)
    lines.push(`started: ${status.startedAt}`)
    lines.push(`updated: ${status.updatedAt}`)
    if (status.lastEventAt) {
      lines.push(`last event at: ${status.lastEventAt}`)
    }
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
  const globalCost = formatCurrency(costs?.totalUSD)
  if (globalCost) {
    lines.push(
      `global cost: ${globalCost} across ${costs?.runs ?? 0} run(s) / ${costs?.totalTurns ?? 0} turn(s)`,
    )
  }
  for (const project of snapshot.projects) {
    lines.push(`project: ${project.projectDir}`)
    lines.push(
      `  worker running: ${project.status?.running === true ? 'yes' : 'no'}`,
    )
    lines.push(
      `  overlap pending: ${project.status?.dirty === true ? 'yes' : 'no'}`,
    )
    lines.push(
      `  pending count: ${formatOptionalValue(project.status?.pendingCount)}`,
    )
    lines.push(`  queued tasks: ${project.tasks.length}`)
    lines.push(`  last event: ${formatOptionalValue(project.status?.lastEvent)}`)
    lines.push(
      `  next fire at: ${formatOptionalValue(project.status?.nextFireAt ?? null)}`,
    )
    lines.push(`  updated: ${formatOptionalValue(project.status?.updatedAt)}`)
    const projectCost = formatCurrency(project.costs?.totalUSD)
    if (projectCost) {
      lines.push(
        `  project cost: ${projectCost} across ${project.costs?.runs ?? 0} run(s) / ${project.costs?.totalTurns ?? 0} turn(s)`,
      )
    }
  }
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

function isPathLike(token: string): boolean {
  return (
    token.startsWith('/') ||
    token.startsWith('.') ||
    token.startsWith('~') ||
    token.includes('\\')
  )
}

function parseBuildRunArgs(
  rest: string[],
): { projectDir: string; brief: string } | null {
  const [first, ...remaining] = rest
  if (!first) {
    return null
  }
  if (isPathLike(first)) {
    const brief = remaining.join(' ').trim()
    if (!brief) return null
    return { projectDir: resolveProjectDir(first), brief }
  }
  return {
    projectDir: getProjectRoot(),
    brief: [first, ...remaining].join(' ').trim(),
  }
}

function requireBuildId(action: string, buildId: string | undefined): string | null {
  if (!buildId?.trim()) {
    return `Usage: /kairos build ${action} <buildId>`
  }
  return null
}

async function handleBuild(rest: string[]): Promise<string> {
  const [action, ...args] = rest
  try {
    switch (action) {
      case 'run': {
        const parsed = parseBuildRunArgs(args)
        if (!parsed) {
          return 'Usage: /kairos build run [projectDir] <brief>'
        }
        const result = await runSoftwareFactoryBuild(parsed)
        return [
          `Software Factory build ${result.buildId}: ${result.status}`,
          `app: ${result.appId}`,
          `title: ${result.title}`,
          `clauses: ${result.clauseCount}`,
          `spec: ${result.specPath}`,
          `project spec: ${result.projectSpecPath}`,
          `eval pack: ${result.evalPackPath}`,
          `project eval pack: ${result.projectEvalPackPath}`,
          `app dir: ${result.appDir}`,
          `review: ${result.reviewPath}`,
          `smoke: ${result.smokePath}`,
          `audit: ${result.auditPath}`,
        ].join('\n')
      }
      case 'list': {
        const builds = await listSoftwareFactoryBuilds()
        if (builds.length === 0) {
          return 'No Software Factory builds found.'
        }
        return builds
          .map(
            build =>
              `${build.buildId} ${build.status} ${build.title} (${build.clauseCount} clause(s))`,
          )
          .join('\n')
      }
      case 'show': {
        const usage = requireBuildId('show', args[0])
        if (usage) return usage
        const build = await readSoftwareFactoryBuild(args[0] as string)
        return [
          `Software Factory build ${build.buildId}: ${build.status}`,
          `created: ${build.createdAt}`,
          `tenant: ${build.tenantId}`,
          `app: ${build.appId}`,
          `title: ${build.title}`,
          `clauses: ${build.clauseCount}`,
          `spec: ${build.specPath}`,
          `project spec: ${build.projectSpecPath}`,
          `eval pack: ${build.evalPackPath}`,
          `project eval pack: ${build.projectEvalPackPath}`,
          `app dir: ${build.appDir}`,
          `review: ${build.reviewPath}`,
          `smoke: ${build.smokePath}`,
          `audit: ${build.auditPath}`,
        ].join('\n')
      }
      case 'verify': {
        const usage = requireBuildId('verify', args[0])
        if (usage) return usage
        const verification = await verifySoftwareFactoryBuild(args[0] as string)
        return [
          `Software Factory build ${verification.buildId}: ${verification.ok ? 'verified' : 'failed'}`,
          ...verification.checks.map(
            check => `${check.ok ? 'PASS' : 'FAIL'} ${check.id}: ${check.detail}`,
          ),
        ].join('\n')
      }
      case 'change': {
        const usage = requireBuildId('change', args[0])
        if (usage) return usage
        const changeText = args.slice(1).join(' ').trim()
        if (!changeText) {
          return 'Usage: /kairos build change <buildId> <change>'
        }
        const proposal = await proposeSoftwareFactoryChange(
          args[0] as string,
          changeText,
        )
        return [
          `Software Factory build ${proposal.buildId}: change proposed`,
          `proposed clause: ${proposal.proposedClauseId}`,
          `generated file: ${proposal.generatedFilePath}`,
          `audit event appended: ${proposal.auditEventAppended ? 'yes' : 'no'}`,
          `proposal: ${proposal.proposalPath}`,
        ].join('\n')
      }
      case 'accept-change': {
        const usage = requireBuildId('accept-change', args[0])
        if (usage) return usage
        const accepted = await acceptSoftwareFactoryChange(args[0] as string)
        return [
          `Software Factory build ${accepted.buildId}: change ${accepted.accepted ? 'accepted' : 'not needed'}`,
          `accepted clause: ${accepted.acceptedClauseId ?? 'none'}`,
          `generated file: ${accepted.generatedFilePath ?? 'none'}`,
          `spec: ${accepted.specPath}`,
          `eval pack: ${accepted.evalPackPath}`,
          `project eval pack: ${accepted.projectEvalPackPath}`,
          `audit event appended: ${accepted.auditEventAppended ? 'yes' : 'no'}`,
        ].join('\n')
      }
      case 'scan': {
        const usage = requireBuildId('scan', args[0])
        if (usage) return usage
        const scan = await scanSoftwareFactoryTraceability(args[0] as string)
        return [
          `Software Factory build ${scan.buildId}: ${scan.ok ? 'traceable' : 'drift detected'}`,
          `scanned files: ${scan.scannedFiles.length}`,
          `untraceable files: ${scan.untraceableFiles.length}`,
          ...scan.untraceableFiles.map(file => `- ${file}`),
          `audit event appended: ${scan.auditEventAppended ? 'yes' : 'no'}`,
          `audit: ${scan.auditPath}`,
        ].join('\n')
      }
      case 'reconcile': {
        const usage = requireBuildId('reconcile', args[0])
        if (usage) return usage
        const reconciliation = await proposeSoftwareFactoryReconciliation(
          args[0] as string,
        )
        return [
          `Software Factory build ${reconciliation.buildId}: reconciliation ${reconciliation.status}`,
          `deltas: ${reconciliation.deltaCount}`,
          `audit event appended: ${reconciliation.auditEventAppended ? 'yes' : 'no'}`,
          `proposal: ${reconciliation.proposalPath}`,
        ].join('\n')
      }
      case 'accept-reconciliation': {
        const usage = requireBuildId('accept-reconciliation', args[0])
        if (usage) return usage
        const accepted = await acceptSoftwareFactoryReconciliation(
          args[0] as string,
        )
        return [
          `Software Factory build ${accepted.buildId}: reconciliation ${accepted.accepted ? 'accepted' : 'not needed'}`,
          `accepted clauses: ${accepted.acceptedClauseIds.join(', ') || 'none'}`,
          `spec: ${accepted.specPath}`,
          `eval pack: ${accepted.evalPackPath}`,
          `project eval pack: ${accepted.projectEvalPackPath}`,
          `audit event appended: ${accepted.auditEventAppended ? 'yes' : 'no'}`,
        ].join('\n')
      }
      case 'export': {
        const usage = requireBuildId('export', args[0])
        if (usage) return usage
        const exported = await exportSoftwareFactoryCompliancePack(
          args[0] as string,
        )
        return [
          `Software Factory build ${exported.buildId}: compliance pack exported`,
          `verified: ${exported.verified ? 'yes' : 'no'}`,
          `generated files: ${exported.fileCount}`,
          `audit events: ${exported.auditEventCount}`,
          `export hash: ${exported.exportHash}`,
          `export: ${exported.exportPath}`,
        ].join('\n')
      }
      default:
        return [
          'Usage:',
          '/kairos build run [projectDir] <brief>',
          '/kairos build list',
          '/kairos build show <buildId>',
          '/kairos build verify <buildId>',
          '/kairos build change <buildId> <change>',
          '/kairos build accept-change <buildId>',
          '/kairos build scan <buildId>',
          '/kairos build reconcile <buildId>',
          '/kairos build accept-reconciliation <buildId>',
          '/kairos build export <buildId>',
        ].join('\n')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return `Software Factory build command failed: ${message}`
  }
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
      if (result.ok === false) return `Setup failed: ${result.reason}`
      const who = result.botUsername ? ` as @${result.botUsername}` : ''
      return `Telegram gateway configured${who}. Now run \`/kairos gateway telegram pair\` to link your chat.`
    }
    case 'pair': {
      const result = await startPairing()
      if (result.ok === false) return result.reason
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
        if (r.ok === false) return r.reason
        return `Unpaired ${r.removed.length} chat(s). Allowlist cleared.`
      }
      const chatId = Number(target)
      if (!Number.isInteger(chatId)) return `Not a numeric chat id: ${target}`
      const r = await unpairTelegram(chatId)
      if (r.ok === false) return r.reason
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
    case 'build':
      return handleBuild(rest)
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
    'status|list|opt-in|opt-out|demo|build|pause|resume|dashboard|logs|cloud|cloud-sync|gateway|skills|skill-improvements|memory-proposals|memory',
  load: () => import('./kairos-ui.js'),
} satisfies Command

export default kairos
