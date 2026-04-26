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

import { createHash } from 'crypto'
import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { getProjectRoot } from '../bootstrap/state.js'
import {
  createDraftBuild,
  type CreateDraftBuildDeps,
} from '../daemon/kairos/draftBuild.js'
import {
  calculateKairosAuditExportEnvelopeHash,
  calculateKairosAuditExportHash,
  calculateKairosBuildAuditMerkleRoot,
  calculateKairosBuildEventAuditHash,
  verifyKairosBuildEventAuditChain,
  verifyKairosAuditExportSignature,
  signKairosAuditExportHash,
} from '../daemon/kairos/buildAudit.js'
import {
  KAIROS_BUILD_STATE_VERSION,
  parseKairosBuildEvent,
  parseKairosBuildResult,
  type KairosBuildEvent,
  type KairosBuildManifest,
  type KairosBuildResult,
  type KairosBuildTraceabilitySeed,
  type KairosBuildTracerSlice,
} from '../daemon/kairos/buildState.js'
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
  readDashboardSnapshot,
  setPauseState,
} from '../daemon/dashboard/model.js'
import { createProjectRegistry } from '../daemon/kairos/projectRegistry.js'
import {
  getKairosPausePath,
  getKairosStatusPath,
  getKairosStdoutLogPath,
  getProjectKairosBuildAuditAnchorPath,
  getProjectKairosBuildDir,
  getProjectKairosBuildEventsPath,
  getProjectKairosBuildResultPath,
  getProjectKairosBuildSpecPath,
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
import { jsonStringify } from '../utils/slowOperations.js'
import {
  createStateWriter,
  type GlobalStatus,
  type PauseState,
  type StateWriter,
} from '../daemon/kairos/stateWriter.js'

const DEFAULT_DASHBOARD_URL = 'http://127.0.0.1:7777/'
const DEFAULT_LOG_TAIL = 25
type KairosBuildEventKind = KairosBuildEvent['kind']

const KAIROS_BUILD_EVENT_KIND_LIST: KairosBuildEventKind[] = [
  'build_created',
  'build_status_changed',
  'spec_written',
  'slice_selected',
  'next_slice_prompt_rendered',
  'slice_completed',
  'clarifying_question_answered',
  'clarifying_question_answer_redacted',
  'agent_event_recorded',
  'build_result_written',
  'build_failed',
]
const KAIROS_BUILD_EVENT_KINDS = new Set<KairosBuildEventKind>(
  KAIROS_BUILD_EVENT_KIND_LIST,
)
const BUILD_EVENTS_USAGE =
  'Usage: /kairos build-events [projectDir] <buildId> [lines] [--kind <kind>]'
const KAIROS_BUILD_AUDIT_REDACTION_POLICY = {
  version: 1,
  eventFields: [
    'clarifying_question_answered.answer',
    'spec_written.specPath',
    'build_result_written.resultPath',
    'build_failed.errorMessage',
  ],
} as const

const HELP_TEXT = `Usage:
/kairos status
/kairos list
/kairos opt-in [projectDir]
/kairos opt-out [projectDir]
/kairos demo [projectDir]
/kairos build [projectDir] <brief>
/kairos builds [projectDir]
/kairos build-show [projectDir] <buildId>
/kairos build-events [projectDir] <buildId> [lines] [--kind <kind>]
/kairos build-slices [projectDir] <buildId>
/kairos build-select [projectDir] <buildId> <sliceId>
/kairos build-select-next [projectDir] <buildId>
/kairos build-select-next-prompt [projectDir] <buildId>
/kairos build-next [projectDir] <buildId>
/kairos build-complete-slice [projectDir] <buildId>
/kairos build-acceptance [projectDir] <buildId>
/kairos build-questions [projectDir] <buildId>
/kairos build-answer [projectDir] <buildId> <questionNumber> <answer>
/kairos build-redact-answer [projectDir] <buildId> <questionNumber>
/kairos build-erasure-report [projectDir] <buildId>
/kairos build-unanswered [projectDir] <buildId>
/kairos build-requirements [projectDir] <buildId>
/kairos build-summary [projectDir] <buildId>
/kairos build-progress [projectDir] <buildId>
/kairos build-readiness [projectDir] <buildId>
/kairos build-assumptions [projectDir] <buildId>
/kairos build-risks [projectDir] <buildId>
/kairos build-goals [projectDir] <buildId>
/kairos build-non-goals [projectDir] <buildId>
/kairos build-users [projectDir] <buildId>
/kairos build-problem [projectDir] <buildId>
/kairos build-traceability [projectDir] <buildId>
/kairos build-prd-outline [projectDir] <buildId>
/kairos build-audit-verify [projectDir] <buildId>
/kairos build-audit-export [projectDir] <buildId>
/kairos build-audit-siem-export [projectDir] <buildId>
/kairos build-audit-export-verify <exportJsonPath>
/kairos build-audit-anchor [projectDir] <buildId>
/kairos build-audit-anchor-verify [projectDir] <buildId>
/kairos export tenant [projectDir]
/kairos export tenant-verify <exportJsonPath>
/kairos import tenant <exportJsonPath> [projectDir]
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
  | 'builds'
  | 'build-show'
  | 'build-events'
  | 'build-slices'
  | 'build-select'
  | 'build-select-next'
  | 'build-select-next-prompt'
  | 'build-next'
  | 'build-complete-slice'
  | 'build-acceptance'
  | 'build-questions'
  | 'build-answer'
  | 'build-redact-answer'
  | 'build-erasure-report'
  | 'build-unanswered'
  | 'build-requirements'
  | 'build-summary'
  | 'build-progress'
  | 'build-readiness'
  | 'build-assumptions'
  | 'build-risks'
  | 'build-goals'
  | 'build-non-goals'
  | 'build-users'
  | 'build-problem'
  | 'build-traceability'
  | 'build-prd-outline'
  | 'build-audit-verify'
  | 'build-audit-export'
  | 'build-audit-siem-export'
  | 'build-audit-export-verify'
  | 'build-audit-anchor'
  | 'build-audit-anchor-verify'
  | 'export'
  | 'import'
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
  'builds',
  'build-show',
  'build-events',
  'build-slices',
  'build-select',
  'build-select-next',
  'build-select-next-prompt',
  'build-next',
  'build-complete-slice',
  'build-acceptance',
  'build-questions',
  'build-answer',
  'build-redact-answer',
  'build-erasure-report',
  'build-unanswered',
  'build-requirements',
  'build-summary',
  'build-progress',
  'build-readiness',
  'build-assumptions',
  'build-risks',
  'build-goals',
  'build-non-goals',
  'build-users',
  'build-problem',
  'build-traceability',
  'build-prd-outline',
  'build-audit-verify',
  'build-audit-export',
  'build-audit-siem-export',
  'build-audit-export-verify',
  'build-audit-anchor',
  'build-audit-anchor-verify',
  'export',
  'import',
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

let kairosBuildDeps: CreateDraftBuildDeps = {}

export function __setKairosBuildDepsForTesting(
  deps: CreateDraftBuildDeps,
): void {
  kairosBuildDeps = deps
}

export function __resetKairosBuildDepsForTesting(): void {
  kairosBuildDeps = {}
}

function isPathLike(token: string): boolean {
  return (
    token.startsWith('/') ||
    token.startsWith('.') ||
    token.startsWith('~') ||
    token.includes('\\')
  )
}

function parseBuildArgs(rest: string[]): { projectDir: string; brief: string } | null {
  if (rest.length === 0) return null
  const [first, ...remaining] = rest
  if (isPathLike(first)) {
    const brief = remaining.join(' ').trim()
    if (!brief) return null
    return { projectDir: resolveProjectDir(first), brief }
  }
  const brief = rest.join(' ').trim()
  if (!brief) return null
  return { projectDir: resolveProjectDir(undefined), brief }
}

function parseBuildShowArgs(
  rest: string[],
): { projectDir: string; buildId: string } | null {
  if (rest.length === 0) return null
  const [first, second] = rest
  if (isPathLike(first)) {
    if (!second) return null
    return { projectDir: resolveProjectDir(first), buildId: second }
  }
  return { projectDir: resolveProjectDir(undefined), buildId: first }
}

function parseBuildEventKind(value: string): KairosBuildEventKind | null {
  if (KAIROS_BUILD_EVENT_KINDS.has(value as KairosBuildEventKind)) {
    return value as KairosBuildEventKind
  }
  return null
}

function parseBuildEventOptions(
  tokens: string[],
):
  | { limit: number; kind?: KairosBuildEventKind }
  | { error: 'invalid_kind'; kind: string }
  | null {
  let limit = DEFAULT_LOG_TAIL
  let kind: KairosBuildEventKind | undefined
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '--kind') {
      const rawKind = tokens[index + 1] ?? ''
      const parsedKind = parseBuildEventKind(rawKind)
      if (!parsedKind) return { error: 'invalid_kind', kind: rawKind }
      kind = parsedKind
      index += 1
      continue
    }
    const parsedLimit = Math.max(1, Math.floor(Number(token)))
    if (!Number.isFinite(parsedLimit)) return null
    limit = parsedLimit
  }
  return { limit, kind }
}

function parseBuildEventsArgs(rest: string[]):
  | {
      projectDir: string
      buildId: string
      limit: number
      kind?: KairosBuildEventKind
    }
  | { error: 'invalid_kind'; kind: string }
  | null {
  if (rest.length === 0) return null
  const [first, second] = rest
  if (isPathLike(first)) {
    if (!second) return null
    const options = parseBuildEventOptions(rest.slice(2))
    if (!options) return null
    if ('error' in options) return options
    return {
      projectDir: resolveProjectDir(first),
      buildId: second,
      ...options,
    }
  }
  const options = parseBuildEventOptions(rest.slice(1))
  if (!options) return null
  if ('error' in options) return options
  return {
    projectDir: resolveProjectDir(undefined),
    buildId: first,
    ...options,
  }
}

function parseBuildSelectArgs(
  rest: string[],
): { projectDir: string; buildId: string; sliceId: string } | null {
  if (rest.length === 0) return null
  const [first, second, third] = rest
  if (isPathLike(first)) {
    if (!second || !third) return null
    return {
      projectDir: resolveProjectDir(first),
      buildId: second,
      sliceId: third,
    }
  }
  if (!second) return null
  return {
    projectDir: resolveProjectDir(undefined),
    buildId: first,
    sliceId: second,
  }
}

function parseBuildAnswerArgs(
  rest: string[],
): { projectDir: string; buildId: string; questionNumber: number; answer: string } | null {
  if (rest.length === 0) return null
  const [first, second, third, ...remaining] = rest
  if (isPathLike(first)) {
    if (!second || !third) return null
    const questionNumber = Number(third)
    const answer = remaining.join(' ').trim()
    if (!Number.isInteger(questionNumber) || questionNumber < 1 || !answer) {
      return null
    }
    return {
      projectDir: resolveProjectDir(first),
      buildId: second,
      questionNumber,
      answer,
    }
  }
  if (!second) return null
  const questionNumber = Number(second)
  const answer = [third, ...remaining].filter(Boolean).join(' ').trim()
  if (!Number.isInteger(questionNumber) || questionNumber < 1 || !answer) {
    return null
  }
  return {
    projectDir: resolveProjectDir(undefined),
    buildId: first,
    questionNumber,
    answer,
  }
}

function parseBuildQuestionNumberArgs(
  rest: string[],
): { projectDir: string; buildId: string; questionNumber: number } | null {
  if (rest.length === 0) return null
  const [first, second, third] = rest
  if (isPathLike(first)) {
    if (!second || !third) return null
    const questionNumber = Number(third)
    if (!Number.isInteger(questionNumber) || questionNumber < 1) return null
    return {
      projectDir: resolveProjectDir(first),
      buildId: second,
      questionNumber,
    }
  }
  if (!second) return null
  const questionNumber = Number(second)
  if (!Number.isInteger(questionNumber) || questionNumber < 1) return null
  return {
    projectDir: resolveProjectDir(undefined),
    buildId: first,
    questionNumber,
  }
}

async function handleBuild(rest: string[]): Promise<string> {
  const parsed = parseBuildArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build [projectDir] <brief>'
  }
  const result = await createDraftBuild(
    parsed.projectDir,
    parsed.brief,
    kairosBuildDeps,
  )
  return [
    `Build draft created: ${result.buildId}`,
    `project: ${result.projectDir}`,
    'status: draft',
    `spec: ${result.specPath}`,
    `manifest: ${result.manifestPath}`,
    `show command: /kairos build-show ${result.projectDir} ${result.buildId}`,
    `readiness command: /kairos build-readiness ${result.projectDir} ${result.buildId}`,
    `next command: /kairos build-select-next-prompt ${result.projectDir} ${result.buildId}`,
  ].join('\n')
}

async function handleBuilds(projectDir: string): Promise<string> {
  const writer = await createStateWriter()
  const builds = await writer.listBuildManifests(projectDir)
  if (builds.length === 0) {
    return `No builds found for ${projectDir}.`
  }
  return [
    `Builds for ${projectDir}:`,
    ...builds.flatMap(
      build => {
        const title = build.title ? ` ${build.title}` : ''
        const selected = build.selectedSliceId
          ? ` selected=${build.selectedSliceId}`
          : ''
        return [
          `- ${build.buildId} [${build.status}]${title}${selected} updated=${build.updatedAt}`,
          `  show command: /kairos build-show ${build.projectDir} ${build.buildId}`,
          `  summary command: /kairos build-summary ${build.projectDir} ${build.buildId}`,
        ]
      },
    ),
  ].join('\n')
}

async function handleBuildShow(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-show [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  const spec = await writer.readBuildSpec(parsed.projectDir, parsed.buildId)
  return [
    `Build: ${manifest.buildId}`,
    `project: ${manifest.projectDir}`,
    `title: ${formatOptionalValue(manifest.title)}`,
    `status: ${manifest.status}`,
    `selected slice: ${formatOptionalValue(manifest.selectedSliceId)}`,
    `brief: ${formatOptionalValue(manifest.brief)}`,
    `created: ${manifest.createdAt}`,
    `updated: ${manifest.updatedAt}`,
    `spec: ${formatOptionalValue(manifest.specPath)}`,
    `summary command: /kairos build-summary ${manifest.projectDir} ${manifest.buildId}`,
    `progress command: /kairos build-progress ${manifest.projectDir} ${manifest.buildId}`,
    `readiness command: /kairos build-readiness ${manifest.projectDir} ${manifest.buildId}`,
    '--- spec ---',
    spec ?? '(spec not found)',
  ].join('\n')
}

function formatBuildEvent(event: KairosBuildEvent): string {
  const auditSuffix = formatBuildEventAuditSuffix(event)
  switch (event.kind) {
    case 'build_created':
      return `${event.t} build_created status=${event.status}${auditSuffix}`
    case 'build_status_changed':
      return `${event.t} build_status_changed ${event.from}->${event.to}${auditSuffix}`
    case 'spec_written':
      return `${event.t} spec_written spec=[redacted]${auditSuffix}`
    case 'slice_selected':
      return `${event.t} slice_selected slice=${event.sliceId} title=${event.title}${auditSuffix}`
    case 'next_slice_prompt_rendered':
      return `${event.t} next_slice_prompt_rendered slice=${event.sliceId} title=${event.title}${auditSuffix}`
    case 'slice_completed':
      return `${event.t} slice_completed slice=${event.sliceId} title=${event.title}${auditSuffix}`
    case 'clarifying_question_answered':
      return `${event.t} clarifying_question_answered question=${event.questionNumber} answer=[redacted]${auditSuffix}`
    case 'clarifying_question_answer_redacted':
      return `${event.t} clarifying_question_answer_redacted question=${event.questionNumber}${auditSuffix}`
    case 'agent_event_recorded':
      return `${event.t} agent_event_recorded run=${event.runId} event=${event.eventKind}${auditSuffix}`
    case 'build_result_written':
      return `${event.t} build_result_written status=${event.status} result=[redacted]${auditSuffix}`
    case 'build_failed':
      return `${event.t} build_failed error=[redacted]${auditSuffix}`
  }
}

function formatBuildEventAuditSuffix(event: KairosBuildEvent): string {
  if (!event.auditHash) return ''
  return ` audit=${event.auditHash} prev=${event.auditPrevHash ?? 'genesis'}`
}

function formatBuildAuditSummary(events: KairosBuildEvent[]): string {
  const verification = verifyKairosBuildEventAuditChain(events)
  if (verification.valid) {
    return `audit: valid events=${verification.eventCount} last=${verification.lastHash ?? 'none'}`
  }
  return `audit: invalid event=${verification.eventNumber} reason=${verification.reason}`
}

async function handleBuildEvents(rest: string[]): Promise<string> {
  const parsed = parseBuildEventsArgs(rest)
  if (parsed === null) {
    return BUILD_EVENTS_USAGE
  }
  if ('error' in parsed) {
    return [
      `Unknown build event kind: ${parsed.kind}`,
      `Supported kinds: ${KAIROS_BUILD_EVENT_KIND_LIST.join(', ')}`,
      BUILD_EVENTS_USAGE,
    ].join('\n')
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }

  const events = (await writer.readBuildEvents(parsed.projectDir, parsed.buildId))
    .filter(event => !parsed.kind || event.kind === parsed.kind)
  if (events.length === 0) {
    const filter = parsed.kind ? ` matching kind ${parsed.kind}` : ''
    return `No build events found for ${parsed.buildId} in ${parsed.projectDir}${filter}.`
  }
  const filter = parsed.kind ? ` kind=${parsed.kind}` : ''
  return [
    `Events for ${parsed.buildId}${filter}:`,
    ...events.slice(-parsed.limit).map(event => `- ${formatBuildEvent(event)}`),
    `summary command: /kairos build-summary ${manifest.projectDir} ${manifest.buildId}`,
    `progress command: /kairos build-progress ${manifest.projectDir} ${manifest.buildId}`,
  ].join('\n')
}

async function handleBuildAuditVerify(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-audit-verify [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }

  const events = await writer.readBuildEvents(parsed.projectDir, parsed.buildId)
  const verification = verifyKairosBuildEventAuditChain(events)
  if (verification.valid) {
    return [
      `Build audit chain valid for ${parsed.buildId}.`,
      `events: ${verification.eventCount}`,
      `last audit hash: ${verification.lastHash ?? 'none'}`,
      `events command: /kairos build-events ${manifest.projectDir} ${manifest.buildId}`,
    ].join('\n')
  }

  return [
    `Build audit chain invalid for ${parsed.buildId}.`,
    `event: ${verification.eventNumber}`,
    `reason: ${verification.reason}`,
    `actual: ${verification.actual ?? 'null'}`,
    `events command: /kairos build-events ${manifest.projectDir} ${manifest.buildId}`,
  ].join('\n')
}

function buildKairosAuditExportEnvelope(
  manifest: KairosBuildManifest,
  events: KairosBuildEvent[],
  verification: ReturnType<typeof verifyKairosBuildEventAuditChain>,
): Record<string, unknown> {
  return {
    version: KAIROS_BUILD_STATE_VERSION,
    buildId: manifest.buildId,
    projectDirHash: calculateKairosAuditExportHash({
      field: 'projectDir',
      value: manifest.projectDir,
    }),
    tenantId: manifest.tenantId,
    valid: verification.valid,
    eventCount: events.length,
    lastHash: verification.valid ? verification.lastHash : null,
    merkleRoot: calculateKairosBuildAuditMerkleRoot(
      events
        .map(event => event.auditHash)
        .filter((auditHash): auditHash is string => typeof auditHash === 'string'),
    ),
    erasureSummary: summarizeKairosAnswerErasure(manifest, events),
    redactionPolicy: KAIROS_BUILD_AUDIT_REDACTION_POLICY,
    failure: verification.valid
      ? undefined
      : {
          eventNumber: verification.eventNumber,
          reason: verification.reason,
          expected: verification.expected ?? null,
          actual: verification.actual ?? null,
        },
    events: events.map((event, index) => ({
      eventNumber: index + 1,
      kind: event.kind,
      t: event.t,
      auditPrevHash: event.auditPrevHash ?? null,
      auditHash: event.auditHash ?? null,
    })),
  }
}

function buildSignedKairosAuditExport(
  manifest: KairosBuildManifest,
  events: KairosBuildEvent[],
  verification: ReturnType<typeof verifyKairosBuildEventAuditChain>,
): Record<string, unknown> {
  const auditExport = buildKairosAuditExportEnvelope(
    manifest,
    events,
    verification,
  )
  const exportHash = calculateKairosAuditExportHash(auditExport)
  return {
    ...auditExport,
    exportHash,
    auditSignature: signKairosAuditExportHash(exportHash),
  }
}

function buildKairosTenantRestoreEvent(event: KairosBuildEvent): KairosBuildEvent {
  switch (event.kind) {
    case 'clarifying_question_answered':
      return {
        ...event,
        answer: '[redacted]',
      }
    case 'spec_written':
      return {
        ...event,
        specPath: '[redacted]',
      }
    case 'build_result_written':
      return {
        ...event,
        resultPath: '[redacted]',
      }
    case 'build_failed':
      return {
        ...event,
        errorMessage: '[redacted]',
      }
    default:
      return event
  }
}

function buildKairosEvalCaseArchives(
  manifest: KairosBuildManifest,
): Record<string, unknown>[] {
  return (manifest.acceptanceChecks ?? []).map((assertion, index) => ({
    id: `${manifest.buildId}-AC-${index + 1}`,
    source: 'acceptance_check',
    assertion,
  }))
}

function buildKairosKnowledgeGraphArchive(
  manifest: KairosBuildManifest,
): Record<string, unknown> {
  const requirementNodes = (manifest.functionalRequirements ?? []).map(
    (label, index) => ({
      id: `${manifest.buildId}-FR-${index + 1}`,
      kind: 'functional_requirement',
      label,
    }),
  )
  const seedNodes = (manifest.traceabilitySeeds ?? []).map(seed => ({
    id: seed.id,
    kind: 'traceability_seed',
    label: seed.text,
    source: seed.source,
  }))
  const sliceNodes = (manifest.tracerSlices ?? []).map(slice => ({
    id: slice.id,
    kind: 'tracer_slice',
    label: slice.title,
  }))
  const sourceSeedId = manifest.traceabilitySeeds?.[0]?.id
  const requirementEdges = sourceSeedId
    ? requirementNodes.map(node => ({
        from: sourceSeedId,
        to: node.id,
        kind: 'supports',
      }))
    : []

  return {
    format: 'kairos_knowledge_graph_v0',
    nodes: [...seedNodes, ...requirementNodes, ...sliceNodes],
    edges: requirementEdges,
  }
}

type KairosTenantArchiveFile = {
  relativePath: string
  contentBase64: string
  sha256: string
  sizeBytes: number
}

function isPathInside(parentDir: string, childPath: string): boolean {
  const relativePath = relative(parentDir, childPath)
  return (
    relativePath === '' ||
    (relativePath.length > 0 &&
      !relativePath.startsWith('..') &&
      !isAbsolute(relativePath))
  )
}

async function readKairosBuildResult(
  projectDir: string,
  buildId: string,
): Promise<KairosBuildResult | null> {
  try {
    return parseKairosBuildResult(
      safeParseJSON(
        await readFile(
          getProjectKairosBuildResultPath(projectDir, buildId),
          'utf8',
        ),
        false,
      ),
    )
  } catch {
    return null
  }
}

async function collectKairosArchiveFiles(
  rootDir: string,
  currentDir = rootDir,
): Promise<KairosTenantArchiveFile[]> {
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(currentDir, { withFileTypes: true })
  } catch {
    return []
  }

  const files: KairosTenantArchiveFile[] = []
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const entryPath = join(currentDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectKairosArchiveFiles(rootDir, entryPath)))
      continue
    }
    if (!entry.isFile()) {
      continue
    }

    const content = await readFile(entryPath)
    files.push({
      relativePath: relative(rootDir, entryPath).replaceAll('\\', '/'),
      contentBase64: content.toString('base64'),
      sha256: createHash('sha256').update(content).digest('hex'),
      sizeBytes: content.byteLength,
    })
  }
  return files
}

async function collectKairosGeneratedAppArchives(
  projectDir: string,
  buildId: string,
): Promise<Record<string, unknown>[]> {
  const result = await readKairosBuildResult(projectDir, buildId)
  if (!result?.appDir) {
    return []
  }

  const resolvedProjectDir = resolve(projectDir)
  const resolvedAppDir = resolve(result.appDir)
  if (!isPathInside(resolvedProjectDir, resolvedAppDir)) {
    return []
  }

  return [
    {
      buildId,
      status: result.status,
      completedAt: result.completedAt,
      summary: result.summary,
      appDirHash: calculateKairosAuditExportHash({
        field: 'appDir',
        value: resolvedAppDir,
      }),
      files: await collectKairosArchiveFiles(resolvedAppDir),
    },
  ]
}

async function restoreKairosGeneratedAppArchives(
  writer: StateWriter,
  projectDir: string,
  buildId: string,
  tenantId: string,
  generatedApps: Record<string, unknown>[],
): Promise<void> {
  for (const [index, generatedApp] of generatedApps.entries()) {
    const appDir = join(
      getProjectKairosBuildDir(projectDir, buildId),
      'generated-apps',
      String(index),
    )
    const files = readArrayField(generatedApp, 'files')
    for (const file of files) {
      const relativePath = readStringField(file, 'relativePath')
      if (!relativePath || typeof file.contentBase64 !== 'string') {
        continue
      }
      const contentBase64 = file.contentBase64

      const targetPath = resolve(appDir, relativePath)
      if (!isPathInside(appDir, targetPath)) {
        continue
      }

      const content = Buffer.from(contentBase64, 'base64')
      const expectedSha256 = readStringField(file, 'sha256')
      if (
        expectedSha256 &&
        createHash('sha256').update(content).digest('hex') !== expectedSha256
      ) {
        continue
      }

      await mkdir(dirname(targetPath), { recursive: true })
      await writeFile(targetPath, content)
    }

    if (index === 0) {
      await writer.writeBuildResult(projectDir, buildId, {
        version: KAIROS_BUILD_STATE_VERSION,
        buildId,
        tenantId,
        status: readKairosBuildStatus(generatedApp.status),
        completedAt: readStringField(
          generatedApp,
          'completedAt',
          new Date(0).toISOString(),
        ),
        summary: readStringField(generatedApp, 'summary', 'Imported app.'),
        appDir,
      })
    }
  }
}

async function handleBuildAuditExport(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-audit-export [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }

  const events = await writer.readBuildEvents(parsed.projectDir, parsed.buildId)
  const verification = verifyKairosBuildEventAuditChain(events)
  return jsonStringify(
    buildSignedKairosAuditExport(manifest, events, verification),
    null,
    2,
  )
}

async function handleBuildAuditSiemExport(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-audit-siem-export [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }

  const events = await writer.readBuildEvents(parsed.projectDir, parsed.buildId)
  const verification = verifyKairosBuildEventAuditChain(events)
  const auditExport = buildSignedKairosAuditExport(
    manifest,
    events,
    verification,
  )
  const auditEvents = Array.isArray(auditExport.events)
    ? (auditExport.events as Array<Record<string, unknown>>)
    : []
  const summaryRecord = {
    recordType: 'kairos_build_audit_summary',
    version: auditExport.version,
    buildId: auditExport.buildId,
    projectDirHash: auditExport.projectDirHash,
    tenantId: auditExport.tenantId,
    valid: auditExport.valid,
    eventCount: auditExport.eventCount,
    lastHash: auditExport.lastHash,
    merkleRoot: auditExport.merkleRoot,
    exportHash: auditExport.exportHash,
    auditSignature: auditExport.auditSignature,
    erasureSummary: auditExport.erasureSummary,
    redactionPolicy: auditExport.redactionPolicy,
    failure: auditExport.failure,
  }
  const eventRecords = auditEvents.map(event => ({
    recordType: 'kairos_build_audit_event',
    buildId: auditExport.buildId,
    tenantId: auditExport.tenantId,
    eventNumber: event.eventNumber,
    kind: event.kind,
    t: event.t,
    auditPrevHash: event.auditPrevHash,
    auditHash: event.auditHash,
  }))

  return [summaryRecord, ...eventRecords]
    .map(record => jsonStringify(record))
    .join('\n')
}

async function handleExport(rest: string[]): Promise<string> {
  const [kind, projectDirArg] = rest
  if (kind === 'tenant-verify') {
    return handleTenantArchiveVerify(rest.slice(1))
  }
  if (kind !== 'tenant') {
    return [
      'Usage: /kairos export tenant [projectDir]',
      'Usage: /kairos export tenant-verify <exportJsonPath>',
    ].join('\n')
  }

  const projectDir = resolveProjectDir(projectDirArg)
  const writer = await createStateWriter()
  const manifests = await writer.listBuildManifests(projectDir)
  const builds = await Promise.all(
    manifests.map(async manifest => {
      const events = await writer.readBuildEvents(projectDir, manifest.buildId)
      const verification = verifyKairosBuildEventAuditChain(events)
      const auditExport = buildSignedKairosAuditExport(
        manifest,
        events,
        verification,
      )
      const auditEvents = Array.isArray(auditExport.events)
        ? (auditExport.events as Array<Record<string, unknown>>)
        : []
      return {
        buildId: manifest.buildId,
        tenantId: manifest.tenantId,
        title: manifest.title ?? manifest.buildId,
        status: manifest.status,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt,
        selectedSliceId: manifest.selectedSliceId ?? null,
        completedSliceIds: manifest.completedSliceIds ?? [],
        metadata: {
          brief: manifest.brief,
          problem: manifest.problem,
          users: manifest.users ?? [],
          goals: manifest.goals ?? [],
          nonGoals: manifest.nonGoals ?? [],
          functionalRequirements: manifest.functionalRequirements ?? [],
          acceptanceChecks: manifest.acceptanceChecks ?? [],
          clarifyingQuestions: manifest.clarifyingQuestions ?? [],
          assumptions: manifest.assumptions ?? [],
          risks: manifest.risks ?? [],
          tracerSlices: manifest.tracerSlices ?? [],
          traceabilitySeeds: manifest.traceabilitySeeds ?? [],
        },
        spec: {
          format: 'markdown',
          body: (await writer.readBuildSpec(projectDir, manifest.buildId)) ?? '',
        },
        audit: {
          valid: auditExport.valid,
          eventCount: auditExport.eventCount,
          lastHash: auditExport.lastHash,
          merkleRoot: auditExport.merkleRoot,
          exportHash: auditExport.exportHash,
          auditSignature: auditExport.auditSignature,
          erasureSummary: auditExport.erasureSummary,
          redactionPolicy: auditExport.redactionPolicy,
          failure: auditExport.failure,
          events: auditEvents,
        },
        restore: {
          events: events.map(buildKairosTenantRestoreEvent),
        },
        generatedApps: await collectKairosGeneratedAppArchives(
          projectDir,
          manifest.buildId,
        ),
        knowledgeGraph: buildKairosKnowledgeGraphArchive(manifest),
        evalCases: buildKairosEvalCaseArchives(manifest),
      }
    }),
  )
  const tenantId = builds[0]?.tenantId ?? 'local'
  const envelope = {
    version: KAIROS_BUILD_STATE_VERSION,
    exportType: 'kairos_tenant_portable_archive',
    tenantId,
    projectDirHash: calculateKairosAuditExportHash({
      field: 'projectDir',
      value: projectDir,
    }),
    buildCount: builds.length,
    builds,
  }

  return jsonStringify(
    {
      ...envelope,
      archiveHash: calculateKairosAuditExportHash(envelope),
    },
    null,
    2,
  )
}

function readRecordField(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const field = value[key]
  return field !== null && typeof field === 'object' && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : null
}

function readArrayField(
  value: Record<string, unknown>,
  key: string,
): Array<Record<string, unknown>> {
  const field = value[key]
  return Array.isArray(field)
    ? (field.filter(
        item => item !== null && typeof item === 'object' && !Array.isArray(item),
      ) as Array<Record<string, unknown>>)
    : []
}

function isRecordArray(value: unknown): value is Array<Record<string, unknown>> {
  return (
    Array.isArray(value) &&
    value.every(
      item => item !== null && typeof item === 'object' && !Array.isArray(item),
    )
  )
}

function isTracerSliceArray(
  value: unknown,
): value is Array<Record<string, unknown>> {
  return (
    isRecordArray(value) &&
    value.every(
      slice =>
        isNonEmptyString(slice.id) &&
        isNonEmptyString(slice.title) &&
        isNonEmptyString(slice.testFirst) &&
        isNonEmptyString(slice.implement),
    )
  )
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isOptionalStringOrNull(
  value: unknown,
): value is string | null | undefined {
  return value === undefined || value === null || isNonEmptyString(value)
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isOptionalNonEmptyString(
  value: unknown,
): value is string | undefined {
  return value === undefined || isNonEmptyString(value)
}

function readStringField(
  value: Record<string, unknown>,
  key: string,
  fallback = '',
): string {
  const field = value[key]
  return typeof field === 'string' ? field : fallback
}

function readStringArrayField(
  value: Record<string, unknown>,
  key: string,
): string[] {
  const field = value[key]
  return Array.isArray(field)
    ? field.filter((item): item is string => typeof item === 'string')
    : []
}

function readTracerSlicesField(
  value: Record<string, unknown>,
): KairosBuildTracerSlice[] {
  return readArrayField(value, 'tracerSlices')
    .map(slice => ({
      id: readStringField(slice, 'id'),
      title: readStringField(slice, 'title'),
      testFirst: readStringField(slice, 'testFirst'),
      implement: readStringField(slice, 'implement'),
    }))
    .filter(
      (slice): slice is KairosBuildTracerSlice =>
        Boolean(slice.id && slice.title && slice.testFirst && slice.implement),
    )
}

function readTraceabilitySeedsField(
  value: Record<string, unknown>,
): KairosBuildTraceabilitySeed[] {
  return readArrayField(value, 'traceabilitySeeds')
    .map(seed => ({
      id: readStringField(seed, 'id'),
      source: readStringField(seed, 'source'),
      text: readStringField(seed, 'text'),
    }))
    .filter(
      (seed): seed is KairosBuildTraceabilitySeed =>
        Boolean(seed.id && seed.source && seed.text),
    )
}

function verifyKairosTenantRestoreEvents(
  buildId: string,
  tenantId: string,
  auditEvents: Record<string, unknown>[],
  restoreEvents: Record<string, unknown>[],
): boolean {
  if (auditEvents.length !== restoreEvents.length) {
    return false
  }

  return restoreEvents.every((restoreEvent, index) => {
    const auditEvent = auditEvents[index]
    if (!auditEvent) {
      return false
    }

    let parsed: KairosBuildEvent
    try {
      parsed = parseKairosBuildEvent({
        ...restoreEvent,
        buildId,
        tenantId,
      })
    } catch {
      return false
    }

    const auditEventNumber =
      typeof auditEvent.eventNumber === 'number' ? auditEvent.eventNumber : null
    return (
      auditEventNumber === index + 1 &&
      parsed.kind === readStringField(auditEvent, 'kind') &&
      parsed.t === readStringField(auditEvent, 't') &&
      (parsed.auditPrevHash ?? null) ===
        (readStringField(auditEvent, 'auditPrevHash') || null) &&
      (parsed.auditHash ?? null) ===
        (readStringField(auditEvent, 'auditHash') || null) &&
      calculateKairosBuildEventAuditHash(parsed) === parsed.auditHash
    )
  })
}

function isSafeArchiveRelativePath(relativePath: string): boolean {
  if (!relativePath || relativePath.includes('\0') || isAbsolute(relativePath)) {
    return false
  }
  const archiveRoot = '/kairos-archive-root'
  return isPathInside(archiveRoot, resolve(archiveRoot, relativePath))
}

function verifyKairosGeneratedAppArchives(
  buildId: string,
  generatedApps: Record<string, unknown>[],
): boolean {
  return generatedApps.every(generatedApp => {
    if (readStringField(generatedApp, 'buildId') !== buildId) {
      return false
    }
    if (!isKairosBuildStatus(generatedApp.status)) {
      return false
    }
    if (!readStringField(generatedApp, 'summary')) {
      return false
    }
    if (!readStringField(generatedApp, 'completedAt')) {
      return false
    }
    if (!isRecordArray(generatedApp.files)) {
      return false
    }
    const seenRelativePaths = new Set<string>()
    return readArrayField(generatedApp, 'files').every(file => {
      const relativePath = readStringField(file, 'relativePath')
      const contentBase64 =
        typeof file.contentBase64 === 'string' ? file.contentBase64 : null
      const expectedSha256 = readStringField(file, 'sha256')
      const expectedSizeBytes = file.sizeBytes
      if (
        !isSafeArchiveRelativePath(relativePath) ||
        seenRelativePaths.has(relativePath) ||
        contentBase64 === null ||
        !expectedSha256 ||
        typeof expectedSizeBytes !== 'number'
      ) {
        return false
      }
      seenRelativePaths.add(relativePath)

      const content = Buffer.from(contentBase64, 'base64')
      return (
        content.toString('base64') === contentBase64 &&
        content.byteLength === expectedSizeBytes &&
        createHash('sha256').update(content).digest('hex') === expectedSha256
      )
    })
  })
}

function buildKairosEvalCaseArchivesFromMetadata(
  buildId: string,
  metadata: Record<string, unknown>,
): Record<string, unknown>[] {
  return readStringArrayField(metadata, 'acceptanceChecks').map(
    (assertion, index) => ({
      id: `${buildId}-AC-${index + 1}`,
      source: 'acceptance_check',
      assertion,
    }),
  )
}

function verifyKairosEvalCaseArchives(
  buildId: string,
  metadata: Record<string, unknown>,
  evalCases: Record<string, unknown>[],
): boolean {
  return (
    calculateKairosAuditExportHash(evalCases) ===
    calculateKairosAuditExportHash(
      buildKairosEvalCaseArchivesFromMetadata(buildId, metadata),
    )
  )
}

function buildKairosKnowledgeGraphArchiveFromMetadata(
  buildId: string,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const requirementNodes = readStringArrayField(
    metadata,
    'functionalRequirements',
  ).map((label, index) => ({
    id: `${buildId}-FR-${index + 1}`,
    kind: 'functional_requirement',
    label,
  }))
  const seedNodes = readTraceabilitySeedsField(metadata).map(seed => ({
    id: seed.id,
    kind: 'traceability_seed',
    label: seed.text,
    source: seed.source,
  }))
  const sliceNodes = readTracerSlicesField(metadata).map(slice => ({
    id: slice.id,
    kind: 'tracer_slice',
    label: slice.title,
  }))
  const sourceSeedId = readTraceabilitySeedsField(metadata)[0]?.id
  const requirementEdges = sourceSeedId
    ? requirementNodes.map(node => ({
        from: sourceSeedId,
        to: node.id,
        kind: 'supports',
      }))
    : []

  return {
    format: 'kairos_knowledge_graph_v0',
    nodes: [...seedNodes, ...requirementNodes, ...sliceNodes],
    edges: requirementEdges,
  }
}

function verifyKairosKnowledgeGraphArchive(
  buildId: string,
  metadata: Record<string, unknown>,
  knowledgeGraph: Record<string, unknown> | null,
): boolean {
  if (!knowledgeGraph) {
    return false
  }

  return (
    calculateKairosAuditExportHash(knowledgeGraph) ===
    calculateKairosAuditExportHash(
      buildKairosKnowledgeGraphArchiveFromMetadata(buildId, metadata),
    )
  )
}

function isKairosBuildStatus(
  value: unknown,
): value is KairosBuildManifest['status'] {
  switch (value) {
    case 'draft':
    case 'queued':
    case 'running':
    case 'needs_review':
    case 'succeeded':
    case 'failed':
    case 'cancelled':
      return true
    default:
      return false
  }
}

function readKairosBuildStatus(value: unknown): KairosBuildManifest['status'] {
  return isKairosBuildStatus(value) ? value : 'draft'
}

async function handleTenantArchiveVerify(rest: string[]): Promise<string> {
  const exportPath = rest.join(' ').trim()
  if (!exportPath) {
    return 'Usage: /kairos export tenant-verify <exportJsonPath>'
  }

  let parsed: unknown
  try {
    parsed = safeParseJSON(await readFile(resolve(exportPath), 'utf8'), false)
  } catch {
    return `Tenant archive invalid: cannot read ${exportPath}.`
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'Tenant archive invalid: file does not contain a JSON object.'
  }

  const archive = parsed as Record<string, unknown>
  if (archive.exportType !== 'kairos_tenant_portable_archive') {
    return `Tenant archive invalid: unsupported exportType ${String(archive.exportType ?? 'missing')}.`
  }
  if (archive.version !== KAIROS_BUILD_STATE_VERSION) {
    return `Tenant archive invalid: unsupported version ${String(archive.version ?? 'missing')}.`
  }
  if (typeof archive.archiveHash !== 'string') {
    return 'Tenant archive invalid: missing archiveHash.'
  }
  const { archiveHash: _archiveHash, ...archiveHashMaterial } = archive
  const expectedArchiveHash =
    calculateKairosAuditExportHash(archiveHashMaterial)
  const archiveHashValid = archive.archiveHash === expectedArchiveHash
  if (!isRecordArray(archive.builds)) {
    return 'Tenant archive invalid: builds contains non-object entries.'
  }
  const builds = readArrayField(archive, 'builds')
  if (archive.buildCount !== builds.length) {
    return `Tenant archive invalid: buildCount mismatch ${String(archive.buildCount ?? 'missing')} != ${builds.length}.`
  }
  const buildTenantId = builds
    .map(build => build.tenantId)
    .find((tenantId): tenantId is string => typeof tenantId === 'string')
  if (buildTenantId && archive.tenantId !== buildTenantId) {
    return `Tenant archive invalid: tenantId mismatch ${String(archive.tenantId ?? 'missing')} != ${buildTenantId}.`
  }
  const seenBuildIds = new Set<string>()
  for (const build of builds) {
    const buildId = readStringField(build, 'buildId')
    if (buildId && seenBuildIds.has(buildId)) {
      return `Tenant archive invalid: duplicate buildId ${buildId}.`
    }
    seenBuildIds.add(buildId)
  }
  const projectDirHash =
    typeof archive.projectDirHash === 'string' ? archive.projectDirHash : null
  const version = archive.version
  const buildLines = builds.map(build => {
    const buildId =
      typeof build.buildId === 'string' ? build.buildId : 'unknown-build'
    const tenantId = typeof build.tenantId === 'string' ? build.tenantId : null
    const audit = readRecordField(build, 'audit')
    if (!audit || projectDirHash === null || tenantId === null) {
      return {
        valid: false,
        line: `- ${buildId}: audit=invalid signature=invalid merkle=invalid`,
      }
    }
    const auditEventsShapeValid = isRecordArray(audit.events)
    const events = readArrayField(audit, 'events')
    const restore = readRecordField(build, 'restore')
    const restoreEventsShapeValid = restore ? isRecordArray(restore.events) : false
    const restoreEvents = restore ? readArrayField(restore, 'events') : []
    const generatedAppsShapeValid = isRecordArray(build.generatedApps)
    const generatedApps = readArrayField(build, 'generatedApps')
    const metadata = readRecordField(build, 'metadata') ?? {}
    const spec = readRecordField(build, 'spec')
    const evalCasesShapeValid = isRecordArray(build.evalCases)
    const evalCases = readArrayField(build, 'evalCases')
    const acceptanceChecksShapeValid = isNonEmptyStringArray(
      metadata.acceptanceChecks,
    )
    const functionalRequirementsShapeValid = isNonEmptyStringArray(
      metadata.functionalRequirements,
    )
    const tracerSlicesShapeValid = isTracerSliceArray(metadata.tracerSlices)
    const traceabilitySeedsShapeValid = isRecordArray(metadata.traceabilitySeeds)
    const completedSliceIdsShapeValid = isNonEmptyStringArray(
      build.completedSliceIds,
    )
    const selectedSliceIdShapeValid = isOptionalStringOrNull(
      build.selectedSliceId,
    )
    const statusShapeValid = isKairosBuildStatus(build.status)
    const titleShapeValid = isNonEmptyString(build.title)
    const createdAtShapeValid = isNonEmptyString(build.createdAt)
    const updatedAtShapeValid = isNonEmptyString(build.updatedAt)
    const specShapeValid =
      spec !== null &&
      spec.format === 'markdown' &&
      typeof spec.body === 'string'
    const briefShapeValid = isOptionalNonEmptyString(metadata.brief)
    const problemShapeValid = isOptionalNonEmptyString(metadata.problem)
    const usersShapeValid = isNonEmptyStringArray(metadata.users)
    const goalsShapeValid = isNonEmptyStringArray(metadata.goals)
    const nonGoalsShapeValid = isNonEmptyStringArray(metadata.nonGoals)
    const clarifyingQuestionsShapeValid = isNonEmptyStringArray(
      metadata.clarifyingQuestions,
    )
    const assumptionsShapeValid = isNonEmptyStringArray(metadata.assumptions)
    const risksShapeValid = isNonEmptyStringArray(metadata.risks)
    const knowledgeGraph = readRecordField(build, 'knowledgeGraph')
    const auditHashMaterial = {
      version,
      buildId,
      projectDirHash,
      tenantId,
      valid: audit.valid,
      eventCount: audit.eventCount,
      lastHash: audit.lastHash,
      merkleRoot: audit.merkleRoot,
      erasureSummary: audit.erasureSummary,
      redactionPolicy: audit.redactionPolicy,
      failure: audit.failure,
      events,
    }
    const expectedAuditHash =
      calculateKairosAuditExportHash(auditHashMaterial)
    const auditValid = audit.exportHash === expectedAuditHash
    const signatureVerification =
      typeof audit.exportHash === 'string'
        ? verifyKairosAuditExportSignature(
            audit.exportHash,
            audit.auditSignature,
          )
        : ({ valid: false, reason: 'missing signature' } as const)
    const signatureStatus = signatureVerification.valid
      ? signatureVerification.status
      : 'invalid'
    const eventHashes = events
      .map(event => event.auditHash)
      .filter((hash): hash is string => typeof hash === 'string')
    const merkleValid =
      audit.merkleRoot === calculateKairosBuildAuditMerkleRoot(eventHashes)
    const lastEventHash = readStringField(events[events.length - 1] ?? {}, 'auditHash')
    const eventSummaryValid =
      auditEventsShapeValid &&
      audit.eventCount === events.length && audit.lastHash === lastEventHash
    const restoreValid =
      restoreEventsShapeValid &&
      verifyKairosTenantRestoreEvents(
        buildId,
        tenantId,
        events,
        restoreEvents,
      )
    const appsValid =
      generatedAppsShapeValid &&
      verifyKairosGeneratedAppArchives(buildId, generatedApps)
    const evalsValid =
      evalCasesShapeValid &&
      acceptanceChecksShapeValid &&
      verifyKairosEvalCaseArchives(
        buildId,
        metadata,
        evalCases,
      )
    const graphValid =
      functionalRequirementsShapeValid &&
      tracerSlicesShapeValid &&
      traceabilitySeedsShapeValid &&
      verifyKairosKnowledgeGraphArchive(
        buildId,
        metadata,
        knowledgeGraph,
      )
    const manifestValid =
      completedSliceIdsShapeValid &&
      selectedSliceIdShapeValid &&
      statusShapeValid &&
      titleShapeValid &&
      createdAtShapeValid &&
      updatedAtShapeValid &&
      specShapeValid &&
      briefShapeValid &&
      problemShapeValid &&
      usersShapeValid &&
      goalsShapeValid &&
      nonGoalsShapeValid &&
      clarifyingQuestionsShapeValid &&
      assumptionsShapeValid &&
      risksShapeValid
    const restoreStatus = restoreValid ? '' : ' restore=invalid'
    const eventsStatus = eventSummaryValid ? '' : ' events=invalid'
    const appsStatus = appsValid ? '' : ' apps=invalid'
    const evalsStatus = evalsValid ? '' : ' evals=invalid'
    const graphStatus = graphValid ? '' : ' graph=invalid'
    const manifestStatus = manifestValid ? '' : ' manifest=invalid'
    return {
      valid:
        auditValid &&
        signatureVerification.valid &&
        merkleValid &&
        eventSummaryValid &&
        restoreValid &&
        appsValid &&
        evalsValid &&
        graphValid &&
        manifestValid,
      line: `- ${buildId}: audit=${auditValid ? 'valid' : 'invalid'} signature=${signatureStatus} merkle=${merkleValid ? 'valid' : 'invalid'}${restoreStatus}${eventsStatus}${appsStatus}${evalsStatus}${graphStatus}${manifestStatus}`,
    }
  })
  const valid = archiveHashValid && buildLines.every(build => build.valid)

  return [
    `Tenant archive ${valid ? 'valid' : 'invalid'}.`,
    `archive hash: ${archiveHashValid ? 'valid' : 'invalid'}`,
    `builds: ${builds.length}`,
    ...buildLines.map(build => build.line),
  ].join('\n')
}

async function handleImport(rest: string[]): Promise<string> {
  const [kind, exportPath, projectDirArg] = rest
  if (kind !== 'tenant' || !exportPath) {
    return 'Usage: /kairos import tenant <exportJsonPath> [projectDir]'
  }

  const verification = await handleTenantArchiveVerify([exportPath])
  if (!verification.startsWith('Tenant archive valid.\n')) {
    return verification
  }

  let parsed: unknown
  try {
    parsed = safeParseJSON(await readFile(resolve(exportPath), 'utf8'), false)
  } catch {
    return `Tenant archive invalid: cannot read ${exportPath}.`
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'Tenant archive invalid: file does not contain a JSON object.'
  }

  const projectDir = resolveProjectDir(projectDirArg)
  const writer = await createStateWriter()
  const builds = readArrayField(parsed as Record<string, unknown>, 'builds')
  const importedLines: string[] = []
  for (const build of builds) {
    const buildId = readStringField(build, 'buildId')
    if (!buildId) {
      continue
    }
    const tenantId = readStringField(build, 'tenantId', 'local')
    const spec = readRecordField(build, 'spec')
    const restore = readRecordField(build, 'restore')
    const metadata = readRecordField(build, 'metadata') ?? {}
    const events = restore ? readArrayField(restore, 'events') : []
    const selectedSliceId = readStringField(build, 'selectedSliceId')
    const manifest: KairosBuildManifest = {
      version: KAIROS_BUILD_STATE_VERSION,
      buildId,
      projectDir,
      tenantId,
      title: readStringField(build, 'title', buildId),
      brief: readStringField(metadata, 'brief') || undefined,
      problem: readStringField(metadata, 'problem') || undefined,
      users: readStringArrayField(metadata, 'users'),
      goals: readStringArrayField(metadata, 'goals'),
      nonGoals: readStringArrayField(metadata, 'nonGoals'),
      functionalRequirements: readStringArrayField(
        metadata,
        'functionalRequirements',
      ),
      acceptanceChecks: readStringArrayField(metadata, 'acceptanceChecks'),
      clarifyingQuestions: readStringArrayField(metadata, 'clarifyingQuestions'),
      assumptions: readStringArrayField(metadata, 'assumptions'),
      risks: readStringArrayField(metadata, 'risks'),
      tracerSlices: readTracerSlicesField(metadata),
      traceabilitySeeds: readTraceabilitySeedsField(metadata),
      status: readKairosBuildStatus(build.status),
      createdAt: readStringField(build, 'createdAt', new Date(0).toISOString()),
      updatedAt: readStringField(build, 'updatedAt', new Date(0).toISOString()),
      completedSliceIds: readStringArrayField(build, 'completedSliceIds'),
      specPath: getProjectKairosBuildSpecPath(projectDir, buildId),
      ...(selectedSliceId ? { selectedSliceId } : {}),
    }

    await writer.ensureBuildDir(projectDir, buildId)
    await writer.writeBuildSpec(
      projectDir,
      buildId,
      readStringField(spec ?? {}, 'body'),
    )
    await writer.writeBuildManifest(projectDir, manifest)
    for (const event of events) {
      await writer.appendBuildEvent(
        projectDir,
        buildId,
        parseKairosBuildEvent({
          ...event,
          buildId,
          tenantId,
        }),
      )
    }
    await restoreKairosGeneratedAppArchives(
      writer,
      projectDir,
      buildId,
      tenantId,
      readArrayField(build, 'generatedApps'),
    )
    importedLines.push(
      `- ${buildId} [${manifest.status}] ${manifest.title ?? buildId}`,
    )
  }

  return [
    'Tenant archive imported.',
    `project: ${projectDir}`,
    `builds: ${importedLines.length}`,
    ...importedLines,
    ...(
      importedLines.length === 1
        ? [
            `verify command: /kairos build-audit-verify ${projectDir} ${readStringField(builds[0] ?? {}, 'buildId')}`,
          ]
        : []
    ),
  ].join('\n')
}

async function handleBuildAuditExportVerify(rest: string[]): Promise<string> {
  const exportPath = rest.join(' ').trim()
  if (!exportPath) {
    return 'Usage: /kairos build-audit-export-verify <exportJsonPath>'
  }

  let parsed: unknown
  try {
    parsed = safeParseJSON(await readFile(resolve(exportPath), 'utf8'), false)
  } catch {
    return `Audit export invalid: cannot read ${exportPath}.`
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'Audit export invalid: file does not contain a JSON object.'
  }

  const auditExport = parsed as Record<string, unknown>
  const buildId =
    typeof auditExport.buildId === 'string' ? auditExport.buildId : 'unknown'
  if (typeof auditExport.exportHash !== 'string') {
    return `Audit export invalid for ${buildId}: missing exportHash.`
  }

  const expectedHash = calculateKairosAuditExportEnvelopeHash(auditExport)
  if (auditExport.exportHash !== expectedHash) {
    return [
      `Audit export invalid for ${buildId}.`,
      'export hash: invalid',
      `expected: ${expectedHash}`,
      `actual: ${auditExport.exportHash}`,
    ].join('\n')
  }

  const signatureVerification = verifyKairosAuditExportSignature(
    auditExport.exportHash,
    auditExport.auditSignature,
  )
  if (!signatureVerification.valid) {
    return [
      `Audit export invalid for ${buildId}.`,
      'export hash: valid',
      `audit signature: invalid reason=${signatureVerification.reason}`,
    ].join('\n')
  }

  if (signatureVerification.status === 'unsigned') {
    return [
      `Audit export valid for ${buildId}.`,
      'export hash: valid',
      `audit signature: unsigned reason=${signatureVerification.reason}`,
    ].join('\n')
  }

  return [
    `Audit export valid for ${buildId}.`,
    'export hash: valid',
    `audit signature: valid key=${signatureVerification.keyId} algorithm=${signatureVerification.algorithm}`,
  ].join('\n')
}

async function handleBuildAuditAnchor(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-audit-anchor [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }

  const events = await writer.readBuildEvents(parsed.projectDir, parsed.buildId)
  const verification = verifyKairosBuildEventAuditChain(events)
  if (!verification.valid) {
    return [
      `Build audit chain invalid for ${parsed.buildId}.`,
      `event: ${verification.eventNumber}`,
      `reason: ${verification.reason}`,
      `audit command: /kairos build-audit-verify ${manifest.projectDir} ${manifest.buildId}`,
    ].join('\n')
  }

  const auditExport = buildKairosAuditExportEnvelope(
    manifest,
    events,
    verification,
  )
  const exportHash = calculateKairosAuditExportHash(auditExport)
  const auditSignature = signKairosAuditExportHash(exportHash)
  const anchorPath = getProjectKairosBuildAuditAnchorPath(
    manifest.projectDir,
    manifest.buildId,
  )
  const anchor = {
    version: KAIROS_BUILD_STATE_VERSION,
    anchorType: 'filesystem',
    buildId: manifest.buildId,
    projectDirHash: auditExport.projectDirHash,
    tenantId: manifest.tenantId,
    anchoredAt: (kairosBuildDeps.now?.() ?? new Date()).toISOString(),
    eventCount: events.length,
    lastHash: verification.lastHash,
    merkleRoot: auditExport.merkleRoot,
    exportHash,
    auditSignature,
  }
  await writeFile(
    anchorPath,
    jsonStringify(
      {
        ...anchor,
        anchorHash: calculateKairosAuditExportHash(anchor),
      },
      null,
      2,
    ),
    'utf8',
  )

  return [
    `Audit anchor written for ${manifest.buildId}.`,
    `anchor: ${anchorPath}`,
    `merkle root: ${anchor.merkleRoot}`,
    `export hash: ${exportHash}`,
  ].join('\n')
}

async function handleBuildAuditAnchorVerify(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-audit-anchor-verify [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }

  const anchorPath = getProjectKairosBuildAuditAnchorPath(
    manifest.projectDir,
    manifest.buildId,
  )
  let parsedAnchor: unknown
  try {
    parsedAnchor = safeParseJSON(await readFile(anchorPath, 'utf8'), false)
  } catch {
    return `Audit anchor invalid for ${manifest.buildId}: cannot read anchor.`
  }
  if (
    parsedAnchor === null ||
    typeof parsedAnchor !== 'object' ||
    Array.isArray(parsedAnchor)
  ) {
    return `Audit anchor invalid for ${manifest.buildId}: file does not contain a JSON object.`
  }

  const anchor = parsedAnchor as Record<string, unknown>
  if (typeof anchor.anchorHash !== 'string') {
    return `Audit anchor invalid for ${manifest.buildId}: missing anchorHash.`
  }
  const expectedAnchorHash = calculateKairosAuditExportHash({
    ...anchor,
    anchorHash: undefined,
  })
  if (anchor.anchorHash !== expectedAnchorHash) {
    return [
      `Audit anchor invalid for ${manifest.buildId}.`,
      'anchor hash: invalid',
      `expected: ${expectedAnchorHash}`,
      `actual: ${anchor.anchorHash}`,
    ].join('\n')
  }

  const events = await writer.readBuildEvents(parsed.projectDir, parsed.buildId)
  const verification = verifyKairosBuildEventAuditChain(events)
  if (!verification.valid) {
    return [
      `Audit anchor invalid for ${manifest.buildId}.`,
      'anchor hash: valid',
      `audit chain: invalid event=${verification.eventNumber} reason=${verification.reason}`,
    ].join('\n')
  }

  const auditExport = buildKairosAuditExportEnvelope(
    manifest,
    events,
    verification,
  )
  const expectedExportHash = calculateKairosAuditExportHash(auditExport)
  if (anchor.exportHash !== expectedExportHash) {
    return [
      `Audit anchor invalid for ${manifest.buildId}.`,
      'anchor hash: valid',
      'export hash: invalid',
      `expected: ${expectedExportHash}`,
      `actual: ${String(anchor.exportHash)}`,
    ].join('\n')
  }

  const signatureVerification = verifyKairosAuditExportSignature(
    expectedExportHash,
    anchor.auditSignature,
  )
  if (!signatureVerification.valid) {
    return [
      `Audit anchor invalid for ${manifest.buildId}.`,
      'anchor hash: valid',
      'export hash: valid',
      `audit signature: invalid reason=${signatureVerification.reason}`,
    ].join('\n')
  }

  const signatureLine =
    signatureVerification.status === 'unsigned'
      ? `audit signature: unsigned reason=${signatureVerification.reason}`
      : `audit signature: valid key=${signatureVerification.keyId} algorithm=${signatureVerification.algorithm}`

  return [
    `Audit anchor valid for ${manifest.buildId}.`,
    'anchor hash: valid',
    'export hash: valid',
    signatureLine,
  ].join('\n')
}

type BuildAuditAnchorReadinessStatus = {
  line: string
  blocker?: string
}

type BuildErasureReadinessStatus = {
  line: string
  blocker?: string
}

function summarizeKairosAnswerErasure(
  manifest: KairosBuildManifest,
  events: KairosBuildEvent[],
): {
  clarifyingAnswers: {
    answered: number
    redacted: number
    erasable: number
  }
  redactionEvents: number
} {
  const redactedQuestionNumbers = new Set(
    events
      .filter(event => event.kind === 'clarifying_question_answer_redacted')
      .map(event => event.questionNumber),
  )
  const answers = manifest.clarifyingQuestionAnswers ?? {}
  let answered = 0
  let redacted = 0
  for (const questionNumber of Object.keys(answers)) {
    const answer = answers[questionNumber]
    if (!answer) continue
    answered += 1
    if (answer === '[redacted]') {
      redacted += 1
    }
  }

  return {
    clarifyingAnswers: {
      answered,
      redacted,
      erasable: answered - redacted,
    },
    redactionEvents: redactedQuestionNumbers.size,
  }
}

function readBuildErasureReadinessStatus(
  manifest: KairosBuildManifest,
  events: KairosBuildEvent[],
): BuildErasureReadinessStatus | null {
  const redactedQuestionNumbers = new Set(
    events
      .filter(event => event.kind === 'clarifying_question_answer_redacted')
      .map(event => event.questionNumber),
  )
  const answers = manifest.clarifyingQuestionAnswers ?? {}
  for (const [questionNumber, answer] of Object.entries(answers)) {
    if (
      answer === '[redacted]' &&
      !redactedQuestionNumbers.has(Number(questionNumber))
    ) {
      return {
        line: 'erasure: invalid reason=redacted answer missing redaction event',
        blocker:
          'Build erasure evidence is invalid: redacted answer missing redaction event.',
      }
    }
  }
  return null
}

async function readBuildAuditAnchorReadinessStatus(
  manifest: KairosBuildManifest,
  events: KairosBuildEvent[],
  verification: ReturnType<typeof verifyKairosBuildEventAuditChain>,
): Promise<BuildAuditAnchorReadinessStatus | null> {
  const invalid = (reason: string): BuildAuditAnchorReadinessStatus => ({
    line: `anchor: invalid reason=${reason}`,
    blocker: `Build audit anchor is invalid: ${reason}.`,
  })
  const anchorPath = getProjectKairosBuildAuditAnchorPath(
    manifest.projectDir,
    manifest.buildId,
  )

  let parsedAnchor: unknown
  try {
    parsedAnchor = safeParseJSON(await readFile(anchorPath, 'utf8'), false)
  } catch {
    return null
  }
  if (
    parsedAnchor === null ||
    typeof parsedAnchor !== 'object' ||
    Array.isArray(parsedAnchor)
  ) {
    return invalid('file is not a JSON object')
  }

  const anchor = parsedAnchor as Record<string, unknown>
  if (typeof anchor.anchorHash !== 'string') {
    return invalid('missing anchorHash')
  }
  const expectedAnchorHash = calculateKairosAuditExportHash({
    ...anchor,
    anchorHash: undefined,
  })
  if (anchor.anchorHash !== expectedAnchorHash) {
    return invalid('anchor hash mismatch')
  }
  if (!verification.valid) {
    return invalid('audit chain invalid')
  }

  const auditExport = buildKairosAuditExportEnvelope(
    manifest,
    events,
    verification,
  )
  const expectedExportHash = calculateKairosAuditExportHash(auditExport)
  if (anchor.exportHash !== expectedExportHash) {
    return invalid('export hash mismatch')
  }

  const signatureVerification = verifyKairosAuditExportSignature(
    expectedExportHash,
    anchor.auditSignature,
  )
  if (!signatureVerification.valid) {
    return invalid(`signature ${signatureVerification.reason}`)
  }
  if (signatureVerification.status === 'unsigned') {
    return {
      line: `anchor: valid signature=unsigned reason=${signatureVerification.reason}`,
    }
  }
  return {
    line: `anchor: valid signature=signed key=${signatureVerification.keyId} algorithm=${signatureVerification.algorithm}`,
  }
}

async function handleBuildSlices(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-slices [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  if (!manifest.tracerSlices || manifest.tracerSlices.length === 0) {
    return `No tracer slices found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Slices for ${parsed.buildId}:`,
    ...manifest.tracerSlices.flatMap(slice => [
      `- ${slice.id} ${slice.title}`,
      `  test: ${slice.testFirst}`,
      `  implement: ${slice.implement}`,
    ]),
    `select command: /kairos build-select ${manifest.projectDir} ${manifest.buildId} <sliceId>`,
    `next command: /kairos build-select-next-prompt ${manifest.projectDir} ${manifest.buildId}`,
  ].join('\n')
}

async function handleBuildAcceptance(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-acceptance [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  if (!manifest.acceptanceChecks || manifest.acceptanceChecks.length === 0) {
    return `No acceptance checks found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Acceptance checks for ${parsed.buildId}:`,
    ...manifest.acceptanceChecks.map(check => `- ${check}`),
    `slices command: /kairos build-slices ${manifest.projectDir} ${manifest.buildId}`,
    `next command: /kairos build-select-next-prompt ${manifest.projectDir} ${manifest.buildId}`,
  ].join('\n')
}

async function handleBuildQuestions(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-questions [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  if (!manifest.clarifyingQuestions || manifest.clarifyingQuestions.length === 0) {
    return `No clarifying questions found for ${parsed.buildId} in ${parsed.projectDir}.`
  }
  const firstUnansweredQuestionNumber =
    findFirstUnansweredClarifyingQuestionNumber(manifest)
  const nextCommand =
    firstUnansweredQuestionNumber > 0
      ? `/kairos build-answer ${manifest.projectDir} ${manifest.buildId} ${firstUnansweredQuestionNumber} <answer>`
      : `/kairos build-readiness ${manifest.projectDir} ${manifest.buildId}`

  return [
    `Clarifying questions for ${parsed.buildId}:`,
    ...renderClarifyingQuestions(manifest),
    `unanswered command: /kairos build-unanswered ${manifest.projectDir} ${manifest.buildId}`,
    `next command: ${nextCommand}`,
  ].join('\n')
}

async function handleBuildAnswer(rest: string[]): Promise<string> {
  const parsed = parseBuildAnswerArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-answer [projectDir] <buildId> <questionNumber> <answer>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  const questions = manifest.clarifyingQuestions ?? []
  if (!questions[parsed.questionNumber - 1]) {
    const validRange =
      questions.length > 0 ? `1-${questions.length}` : 'none'
    return `No clarifying question ${parsed.questionNumber} found for ${parsed.buildId}. Valid question numbers are ${validRange}. Run \`/kairos build-questions ${parsed.projectDir} ${parsed.buildId}\` to inspect them.`
  }

  const clarifyingQuestionAnswers = {
    ...(manifest.clarifyingQuestionAnswers ?? {}),
    [String(parsed.questionNumber)]: parsed.answer,
  }
  const updatedManifest = {
    ...manifest,
    clarifyingQuestionAnswers,
    updatedAt: new Date().toISOString(),
  }
  await writer.writeBuildManifest(parsed.projectDir, updatedManifest)
  await writer.appendBuildEvent(parsed.projectDir, parsed.buildId, {
    version: 1,
    kind: 'clarifying_question_answered',
    buildId: parsed.buildId,
    tenantId: manifest.tenantId,
    t: new Date().toISOString(),
    questionNumber: parsed.questionNumber,
    question: questions[parsed.questionNumber - 1],
    answer: '[redacted]',
  })

  const remainingQuestions =
    renderUnansweredClarifyingQuestions(updatedManifest).length
  const nextCommand =
    remainingQuestions > 0
      ? `/kairos build-unanswered ${parsed.projectDir} ${parsed.buildId}`
      : `/kairos build-readiness ${parsed.projectDir} ${parsed.buildId}`
  return [
    `Answered question ${parsed.questionNumber} for ${parsed.buildId}: ${parsed.answer}`,
    `unanswered clarifying questions remaining: ${remainingQuestions}`,
    `next command: ${nextCommand}`,
  ].join('\n')
}

async function handleBuildRedactAnswer(rest: string[]): Promise<string> {
  const parsed = parseBuildQuestionNumberArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-redact-answer [projectDir] <buildId> <questionNumber>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  const questions = manifest.clarifyingQuestions ?? []
  if (!questions[parsed.questionNumber - 1]) {
    const validRange =
      questions.length > 0 ? `1-${questions.length}` : 'none'
    return `No clarifying question ${parsed.questionNumber} found for ${parsed.buildId}. Valid question numbers are ${validRange}. Run \`/kairos build-questions ${parsed.projectDir} ${parsed.buildId}\` to inspect them.`
  }

  const answerKey = String(parsed.questionNumber)
  const existingAnswer = manifest.clarifyingQuestionAnswers?.[answerKey]
  if (!existingAnswer) {
    return [
      `No answer recorded for question ${parsed.questionNumber} in ${parsed.buildId}.`,
      `questions command: /kairos build-questions ${parsed.projectDir} ${parsed.buildId}`,
    ].join('\n')
  }
  if (existingAnswer === '[redacted]') {
    return [
      `Answer for question ${parsed.questionNumber} in ${parsed.buildId} is already redacted.`,
      `audit command: /kairos build-audit-verify ${parsed.projectDir} ${parsed.buildId}`,
      `events command: /kairos build-events ${parsed.projectDir} ${parsed.buildId} --kind clarifying_question_answer_redacted`,
    ].join('\n')
  }

  const updatedManifest = {
    ...manifest,
    clarifyingQuestionAnswers: {
      ...(manifest.clarifyingQuestionAnswers ?? {}),
      [answerKey]: '[redacted]',
    },
    updatedAt: new Date().toISOString(),
  }
  await writer.writeBuildManifest(parsed.projectDir, updatedManifest)

  const events = await writer.readBuildEvents(parsed.projectDir, parsed.buildId)
  const redactedEvents = events.map(event => {
    if (
      event.kind === 'clarifying_question_answered' &&
      event.questionNumber === parsed.questionNumber
    ) {
      return {
        ...event,
        answer: '[redacted]',
      }
    }
    return event
  })
  await writeFile(
    getProjectKairosBuildEventsPath(parsed.projectDir, parsed.buildId),
    `${redactedEvents.map(event => jsonStringify(event)).join('\n')}\n`,
    'utf8',
  )
  await writer.appendBuildEvent(parsed.projectDir, parsed.buildId, {
    version: KAIROS_BUILD_STATE_VERSION,
    kind: 'clarifying_question_answer_redacted',
    buildId: parsed.buildId,
    tenantId: manifest.tenantId,
    t: new Date().toISOString(),
    questionNumber: parsed.questionNumber,
  })

  return [
    `Redacted answer for question ${parsed.questionNumber} in ${parsed.buildId}.`,
    `audit command: /kairos build-audit-verify ${parsed.projectDir} ${parsed.buildId}`,
    `events command: /kairos build-events ${parsed.projectDir} ${parsed.buildId} --kind clarifying_question_answer_redacted`,
  ].join('\n')
}

async function handleBuildErasureReport(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-erasure-report [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }

  const events = await writer.readBuildEvents(parsed.projectDir, parsed.buildId)
  const erasureSummary = summarizeKairosAnswerErasure(manifest, events)
  const redactedQuestionNumbers = new Set(
    events
      .filter(event => event.kind === 'clarifying_question_answer_redacted')
      .map(event => event.questionNumber),
  )
  const answers = manifest.clarifyingQuestionAnswers ?? {}
  const questions = manifest.clarifyingQuestions ?? []
  let answeredCount = 0
  let redactedCount = 0
  const questionLines = questions.map((_question, index) => {
    const questionNumber = index + 1
    const answer = answers[String(questionNumber)]
    if (!answer) {
      return `- question ${questionNumber}: unanswered`
    }
    answeredCount += 1
    if (answer === '[redacted]') {
      redactedCount += 1
      const eventRecorded = redactedQuestionNumbers.has(questionNumber)
        ? 'yes'
        : 'no'
      return `- question ${questionNumber}: redacted event=${eventRecorded}`
    }
    return `- question ${questionNumber}: answered`
  })
  const erasableCount = answeredCount - redactedCount

  return [
    `Erasure report for ${manifest.buildId}:`,
    `clarifying answers: ${answeredCount} answered, ${redactedCount} redacted, ${erasableCount} erasable`,
    `redaction events: ${erasureSummary.redactionEvents}`,
    ...questionLines,
    `redact command: /kairos build-redact-answer ${manifest.projectDir} ${manifest.buildId} <questionNumber>`,
    `audit command: /kairos build-audit-verify ${manifest.projectDir} ${manifest.buildId}`,
  ].join('\n')
}

async function handleBuildUnanswered(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-unanswered [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  const unanswered = renderUnansweredClarifyingQuestions(manifest)
  if (unanswered.length === 0) {
    return [
      `No unanswered clarifying questions for ${parsed.buildId}.`,
      `next command: /kairos build-readiness ${parsed.projectDir} ${parsed.buildId}`,
    ].join('\n')
  }
  const firstUnansweredQuestionNumber =
    findFirstUnansweredClarifyingQuestionNumber(manifest)

  return [
    `Unanswered clarifying questions for ${parsed.buildId}:`,
    ...unanswered,
    `next command: /kairos build-answer ${parsed.projectDir} ${parsed.buildId} ${firstUnansweredQuestionNumber} <answer>`,
  ].join('\n')
}

async function handleBuildRequirements(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-requirements [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  if (
    !manifest.functionalRequirements ||
    manifest.functionalRequirements.length === 0
  ) {
    return `No functional requirements found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Functional requirements for ${parsed.buildId}:`,
    ...manifest.functionalRequirements.map(requirement => `- ${requirement}`),
    ...renderBuildPrdStatusCommands(manifest),
  ].join('\n')
}

async function handleBuildSummary(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-summary [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  const events = await writer.readBuildEvents(parsed.projectDir, parsed.buildId)
  const latestEvent = events.at(-1)
  const latestEventLabel = latestEvent
    ? `${latestEvent.kind} at ${latestEvent.t}`
    : '—'
  const questionReadiness = countAnsweredClarifyingQuestions(manifest)
  const erasureSummary = summarizeKairosAnswerErasure(manifest, events)

  return [
    `Build summary for ${parsed.buildId}:`,
    `title: ${formatOptionalValue(manifest.title)}`,
    `status: ${manifest.status}`,
    `selected slice: ${formatOptionalValue(manifest.selectedSliceId)}`,
    `problem: ${manifest.problem ? 'yes' : 'no'}`,
    `users: ${manifest.users?.length ?? 0}`,
    `goals: ${manifest.goals?.length ?? 0}`,
    `non-goals: ${manifest.nonGoals?.length ?? 0}`,
    `functional requirements: ${manifest.functionalRequirements?.length ?? 0}`,
    `acceptance checks: ${manifest.acceptanceChecks?.length ?? 0}`,
    `clarifying questions: ${questionReadiness.total}`,
    `answered questions: ${questionReadiness.answered}/${questionReadiness.total}`,
    `erasure: ${erasureSummary.clarifyingAnswers.redacted} redacted, ${erasureSummary.clarifyingAnswers.erasable} erasable`,
    `assumptions: ${manifest.assumptions?.length ?? 0}`,
    `risks: ${manifest.risks?.length ?? 0}`,
    `tracer slices: ${manifest.tracerSlices?.length ?? 0}`,
    `completed slices: ${manifest.completedSliceIds?.length ?? 0}`,
    `traceability seeds: ${manifest.traceabilitySeeds?.length ?? 0}`,
    `last event: ${latestEventLabel}`,
    formatBuildAuditSummary(events),
    `progress command: /kairos build-progress ${manifest.projectDir} ${manifest.buildId}`,
    `readiness command: /kairos build-readiness ${manifest.projectDir} ${manifest.buildId}`,
    `brief: ${formatOptionalValue(manifest.brief)}`,
  ].join('\n')
}

function formatTracerSliceProgress(
  slice: KairosBuildTracerSlice,
  completedSliceIds: Set<string>,
  selectedSliceId: string | undefined,
): string {
  let state = 'pending'
  if (completedSliceIds.has(slice.id)) {
    state = 'complete'
  } else if (slice.id === selectedSliceId) {
    state = 'selected'
  }
  return `- ${slice.id} ${slice.title} [${state}]`
}

async function handleBuildProgress(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-progress [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  if (!manifest.tracerSlices || manifest.tracerSlices.length === 0) {
    return `No tracer slices found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  const completedSliceIds = new Set(manifest.completedSliceIds ?? [])
  const completedCount = manifest.tracerSlices.filter(slice =>
    completedSliceIds.has(slice.id),
  ).length
  const totalCount = manifest.tracerSlices.length
  const remainingCount = totalCount - completedCount
  const nextSlice =
    manifest.tracerSlices.find(
      slice =>
        slice.id === manifest.selectedSliceId &&
        !completedSliceIds.has(slice.id),
    ) ??
    manifest.tracerSlices.find(slice => !completedSliceIds.has(slice.id))
  const nextSliceLabel = nextSlice ? `${nextSlice.id} ${nextSlice.title}` : '—'
  let nextCommand = '—'
  if (nextSlice) {
    nextCommand =
      nextSlice.id === manifest.selectedSliceId
        ? `/kairos build-next ${manifest.projectDir} ${manifest.buildId}`
        : `/kairos build-select-next-prompt ${manifest.projectDir} ${manifest.buildId}`
  }
  return [
    `Build progress for ${parsed.buildId}:`,
    `readiness: ${deriveBuildReadinessState(manifest)}`,
    `selected slice: ${formatOptionalValue(manifest.selectedSliceId)}`,
    `completed slices: ${completedCount}/${totalCount}`,
    `remaining slices: ${remainingCount}`,
    `next slice: ${nextSliceLabel}`,
    `next command: ${nextCommand}`,
    `readiness command: /kairos build-readiness ${manifest.projectDir} ${manifest.buildId}`,
    ...manifest.tracerSlices.map(slice =>
      formatTracerSliceProgress(
        slice,
        completedSliceIds,
        manifest.selectedSliceId,
      ),
    ),
  ].join('\n')
}

function deriveBuildReadinessState(
  manifest: KairosBuildManifest,
): 'blocked' | 'ready' {
  const completedSliceIds = new Set(manifest.completedSliceIds ?? [])
  const selectedSlice = manifest.tracerSlices?.find(
    slice => slice.id === manifest.selectedSliceId,
  )
  const selectedSliceIsIncomplete =
    selectedSlice !== undefined && !completedSliceIds.has(selectedSlice.id)
  const hasIncompleteSlice = Boolean(
    manifest.tracerSlices?.some(slice => !completedSliceIds.has(slice.id)),
  )
  const hasUnansweredQuestions =
    renderUnansweredClarifyingQuestions(manifest).length > 0

  return (hasIncompleteSlice && !selectedSliceIsIncomplete) ||
    hasUnansweredQuestions
    ? 'blocked'
    : 'ready'
}

async function handleBuildReadiness(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-readiness [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }

  const events = await writer.readBuildEvents(parsed.projectDir, parsed.buildId)
  const auditVerification = verifyKairosBuildEventAuditChain(events)
  const anchorStatus = await readBuildAuditAnchorReadinessStatus(
    manifest,
    events,
    auditVerification,
  )
  const erasureStatus = readBuildErasureReadinessStatus(manifest, events)
  const latestEvent = events.at(-1)
  const latestEventLabel = latestEvent
    ? `${latestEvent.kind} at ${latestEvent.t}`
    : '—'
  const completedSliceIds = new Set(manifest.completedSliceIds ?? [])
  const totalSlices = manifest.tracerSlices?.length ?? 0
  const completedSlices =
    manifest.tracerSlices?.filter(slice => completedSliceIds.has(slice.id))
      .length ?? 0
  const selectedSlice = manifest.tracerSlices?.find(
    slice => slice.id === manifest.selectedSliceId,
  )
  const selectedSliceIsIncomplete =
    selectedSlice !== undefined && !completedSliceIds.has(selectedSlice.id)
  const hasIncompleteSlice = Boolean(
    manifest.tracerSlices?.some(slice => !completedSliceIds.has(slice.id)),
  )
  const selectedSliceLabel = selectedSlice
    ? `${selectedSlice.id} ${selectedSlice.title}`
    : '—'
  let nextCommand = '—'
  if (selectedSliceIsIncomplete) {
    nextCommand = `/kairos build-next ${manifest.projectDir} ${manifest.buildId}`
  } else if (hasIncompleteSlice) {
    nextCommand = `/kairos build-select-next-prompt ${manifest.projectDir} ${manifest.buildId}`
  }
  const questionReadiness = countAnsweredClarifyingQuestions(manifest)
  const unansweredQuestions = renderUnansweredClarifyingQuestions(manifest)
  const auditBlockers = auditVerification.valid
    ? []
    : [
        `Build audit chain is invalid at event ${auditVerification.eventNumber}: ${auditVerification.reason}.`,
      ]
  const anchorBlockers = anchorStatus?.blocker ? [anchorStatus.blocker] : []
  const erasureBlockers = erasureStatus?.blocker ? [erasureStatus.blocker] : []
  const blockers = [
    ...(hasIncompleteSlice && !selectedSliceIsIncomplete
      ? ['Select an incomplete tracer slice before running build-next.']
      : []),
    ...unansweredQuestions,
    ...auditBlockers,
    ...anchorBlockers,
    ...erasureBlockers,
  ]
  const blockerLines =
    blockers.length > 0
      ? ['blockers:', ...blockers.map(blocker => `- ${blocker}`)]
      : ['blockers: none']
  const readinessState = blockers.length > 0 ? 'blocked' : 'ready'
  const questionCommandLines =
    unansweredQuestions.length > 0
      ? [
          `questions command: /kairos build-unanswered ${manifest.projectDir} ${manifest.buildId}`,
        ]
      : []

  return [
    `Build readiness for ${parsed.buildId}:`,
    `readiness: ${readinessState}`,
    `selected slice: ${selectedSliceLabel}`,
    `completed slices: ${completedSlices}/${totalSlices}`,
    `clarifying questions answered: ${questionReadiness.answered}/${questionReadiness.total}`,
    `unanswered clarifying questions: ${unansweredQuestions.length}`,
    `last event: ${latestEventLabel}`,
    formatBuildAuditSummary(events),
    ...(anchorStatus ? [anchorStatus.line] : []),
    ...(erasureStatus ? [erasureStatus.line] : []),
    `next command: ${nextCommand}`,
    ...questionCommandLines,
    ...blockerLines,
  ].join('\n')
}

async function handleBuildUsers(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-users [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  if (!manifest.users || manifest.users.length === 0) {
    return `No users found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Users for ${parsed.buildId}:`,
    ...manifest.users.map(user => `- ${user}`),
    ...renderBuildPrdStatusCommands(manifest),
  ].join('\n')
}

async function handleBuildProblem(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-problem [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  if (!manifest.problem) {
    return `No problem statement found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Problem for ${parsed.buildId}:`,
    manifest.problem,
    ...renderBuildPrdStatusCommands(manifest),
  ].join('\n')
}

async function handleBuildTraceability(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-traceability [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  if (!manifest.traceabilitySeeds || manifest.traceabilitySeeds.length === 0) {
    return `No traceability seeds found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Traceability seeds for ${parsed.buildId}:`,
    ...manifest.traceabilitySeeds.map(
      seed => `- ${seed.id} [${seed.source}] ${seed.text}`,
    ),
    ...renderBuildPrdStatusCommands(manifest),
  ].join('\n')
}

function renderBuildPrdStatusCommands(manifest: KairosBuildManifest): string[] {
  return [
    `outline command: /kairos build-prd-outline ${manifest.projectDir} ${manifest.buildId}`,
    `readiness command: /kairos build-readiness ${manifest.projectDir} ${manifest.buildId}`,
  ]
}

function appendBulletSection(
  lines: string[],
  title: string,
  items: string[] | undefined,
): void {
  if (!items || items.length === 0) return
  lines.push(`${title}:`, ...items.map(item => `- ${item}`))
}

function appendNumberedSection(
  lines: string[],
  title: string,
  items: string[] | undefined,
): void {
  if (!items || items.length === 0) return
  lines.push(
    `${title}:`,
    ...items.map((item, index) => `${index + 1}. ${item}`),
  )
}

function renderClarifyingQuestions(
  manifest: KairosBuildManifest,
): string[] {
  if (!manifest.clarifyingQuestions || manifest.clarifyingQuestions.length === 0) {
    return []
  }
  return manifest.clarifyingQuestions.flatMap((question, index) => {
    const questionNumber = String(index + 1)
    const answer = manifest.clarifyingQuestionAnswers?.[questionNumber]
    return answer
      ? [`${questionNumber}. ${question}`, `   answer: ${answer}`]
      : [`${questionNumber}. ${question}`]
  })
}

function appendClarifyingQuestionSection(
  lines: string[],
  manifest: KairosBuildManifest,
): void {
  const renderedQuestions = renderClarifyingQuestions(manifest)
  if (renderedQuestions.length === 0) return
  lines.push('clarifying questions:', ...renderedQuestions)
}

function appendTraceabilitySeedSection(
  lines: string[],
  seeds: KairosBuildManifest['traceabilitySeeds'],
): void {
  if (!seeds || seeds.length === 0) return
  lines.push(
    'traceability seeds:',
    ...seeds.map(seed => `- ${seed.id} [${seed.source}] ${seed.text}`),
  )
}

function countAnsweredClarifyingQuestions(manifest: KairosBuildManifest): {
  answered: number
  total: number
} {
  const total = manifest.clarifyingQuestions?.length ?? 0
  const answered = Object.keys(manifest.clarifyingQuestionAnswers ?? {}).filter(
    key => Number(key) >= 1 && Number(key) <= total,
  ).length
  return { answered, total }
}

function renderUnansweredClarifyingQuestions(
  manifest: KairosBuildManifest,
): string[] {
  if (!manifest.clarifyingQuestions || manifest.clarifyingQuestions.length === 0) {
    return []
  }
  return manifest.clarifyingQuestions.flatMap((question, index) => {
    const questionNumber = String(index + 1)
    return manifest.clarifyingQuestionAnswers?.[questionNumber]
      ? []
      : [`${questionNumber}. ${question}`]
  })
}

function findFirstUnansweredClarifyingQuestionNumber(
  manifest: KairosBuildManifest,
): number {
  const questionIndex = manifest.clarifyingQuestions?.findIndex(
    (_, index) => !manifest.clarifyingQuestionAnswers?.[String(index + 1)],
  )
  return questionIndex === undefined || questionIndex < 0
    ? 0
    : questionIndex + 1
}

async function handleBuildPrdOutline(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-prd-outline [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }

  const lines = [
    `PRD outline for ${parsed.buildId}:`,
    `title: ${formatOptionalValue(manifest.title)}`,
    `problem: ${formatOptionalValue(manifest.problem)}`,
  ]
  appendBulletSection(lines, 'users', manifest.users)
  appendBulletSection(lines, 'goals', manifest.goals)
  appendBulletSection(lines, 'non-goals', manifest.nonGoals)
  appendBulletSection(
    lines,
    'functional requirements',
    manifest.functionalRequirements,
  )
  appendBulletSection(lines, 'acceptance checks', manifest.acceptanceChecks)
  appendBulletSection(lines, 'assumptions', manifest.assumptions)
  appendBulletSection(lines, 'risks', manifest.risks)
  appendClarifyingQuestionSection(lines, manifest)
  appendTraceabilitySeedSection(lines, manifest.traceabilitySeeds)
  lines.push(
    `show command: /kairos build-show ${manifest.projectDir} ${manifest.buildId}`,
    `readiness command: /kairos build-readiness ${manifest.projectDir} ${manifest.buildId}`,
  )

  return lines.join('\n')
}

async function handleBuildGoals(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-goals [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  if (!manifest.goals || manifest.goals.length === 0) {
    return `No goals found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Goals for ${parsed.buildId}:`,
    ...manifest.goals.map(goal => `- ${goal}`),
    ...renderBuildPrdStatusCommands(manifest),
  ].join('\n')
}

async function handleBuildNonGoals(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-non-goals [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  if (!manifest.nonGoals || manifest.nonGoals.length === 0) {
    return `No non-goals found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Non-goals for ${parsed.buildId}:`,
    ...manifest.nonGoals.map(nonGoal => `- ${nonGoal}`),
    ...renderBuildPrdStatusCommands(manifest),
  ].join('\n')
}

async function handleBuildAssumptions(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-assumptions [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  if (!manifest.assumptions || manifest.assumptions.length === 0) {
    return `No assumptions found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Assumptions for ${parsed.buildId}:`,
    ...manifest.assumptions.map(assumption => `- ${assumption}`),
    ...renderBuildPrdStatusCommands(manifest),
  ].join('\n')
}

async function handleBuildRisks(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-risks [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  if (!manifest.risks || manifest.risks.length === 0) {
    return `No risks found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Risks for ${parsed.buildId}:`,
    ...manifest.risks.map(risk => `- ${risk}`),
    ...renderBuildPrdStatusCommands(manifest),
  ].join('\n')
}

async function persistSelectedBuildSlice(
  writer: StateWriter,
  projectDir: string,
  manifest: KairosBuildManifest,
  slice: KairosBuildTracerSlice,
): Promise<string> {
  const updatedAt = new Date().toISOString()
  await writer.writeBuildManifest(projectDir, {
    ...manifest,
    selectedSliceId: slice.id,
    updatedAt,
  })
  await writer.appendBuildEvent(projectDir, manifest.buildId, {
    version: 1,
    kind: 'slice_selected',
    buildId: manifest.buildId,
    tenantId: manifest.tenantId,
    t: updatedAt,
    sliceId: slice.id,
    title: slice.title,
  })

  return [
    `Selected ${slice.id} for ${manifest.buildId}: ${slice.title}`,
    `test: ${slice.testFirst}`,
    `implement: ${slice.implement}`,
    `next command: /kairos build-next ${projectDir} ${manifest.buildId}`,
    `progress command: /kairos build-progress ${projectDir} ${manifest.buildId}`,
  ].join('\n')
}

async function handleBuildSelect(rest: string[]): Promise<string> {
  const parsed = parseBuildSelectArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-select [projectDir] <buildId> <sliceId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  const slice = manifest.tracerSlices?.find(
    candidate => candidate.id === parsed.sliceId,
  )
  if (!slice) {
    return [
      `No tracer slice ${parsed.sliceId} found for ${parsed.buildId}.`,
      `slices command: /kairos build-slices ${parsed.projectDir} ${parsed.buildId}`,
    ].join('\n')
  }

  return persistSelectedBuildSlice(writer, parsed.projectDir, manifest, slice)
}

async function handleBuildSelectNext(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-select-next [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  if (!manifest.tracerSlices || manifest.tracerSlices.length === 0) {
    return `No tracer slices found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  const currentIndex = manifest.selectedSliceId
    ? manifest.tracerSlices.findIndex(
        slice => slice.id === manifest.selectedSliceId,
      )
    : -1
  const completedSliceIds = new Set(manifest.completedSliceIds ?? [])
  const nextSlice = manifest.tracerSlices.find(
    (slice, index) => index > currentIndex && !completedSliceIds.has(slice.id),
  )
  if (!nextSlice) {
    const selectedSliceIsIncomplete =
      manifest.selectedSliceId !== undefined &&
      !completedSliceIds.has(manifest.selectedSliceId)
    if (selectedSliceIsIncomplete) {
      return [
        `No next tracer slice found after ${manifest.selectedSliceId} for ${parsed.buildId}.`,
        `next command: /kairos build-next ${parsed.projectDir} ${parsed.buildId}`,
        `progress command: /kairos build-progress ${parsed.projectDir} ${parsed.buildId}`,
      ].join('\n')
    }
    if (completedSliceIds.size > 0) {
      const after = manifest.selectedSliceId ?? 'the beginning'
      return [
        `No incomplete tracer slice found after ${after} for ${parsed.buildId}.`,
        `progress command: /kairos build-progress ${parsed.projectDir} ${parsed.buildId}`,
        `readiness command: /kairos build-readiness ${parsed.projectDir} ${parsed.buildId}`,
      ].join('\n')
    }
    return `No next tracer slice found for ${parsed.buildId}.`
  }

  return persistSelectedBuildSlice(
    writer,
    parsed.projectDir,
    manifest,
    nextSlice,
  )
}

async function handleBuildNext(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-next [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  if (!manifest.selectedSliceId) {
    return `No tracer slice selected for ${parsed.buildId}. Run \`/kairos build-select ${parsed.projectDir} ${parsed.buildId} <sliceId>\` first.`
  }
  const slice = manifest.tracerSlices?.find(
    candidate => candidate.id === manifest.selectedSliceId,
  )
  if (!slice) {
    return `Selected tracer slice ${manifest.selectedSliceId} is missing for ${parsed.buildId}.`
  }
  if ((manifest.completedSliceIds ?? []).includes(slice.id)) {
    return `Selected tracer slice ${slice.id} is already complete for ${parsed.buildId}. Run \`/kairos build-select-next ${parsed.projectDir} ${parsed.buildId}\` first.`
  }
  const anchorLines: string[] = ['PRD anchors:']
  appendBulletSection(
    anchorLines,
    'functional requirements',
    manifest.functionalRequirements,
  )
  appendBulletSection(anchorLines, 'acceptance checks', manifest.acceptanceChecks)
  appendTraceabilitySeedSection(anchorLines, manifest.traceabilitySeeds)
  const questionReadiness = countAnsweredClarifyingQuestions(manifest)
  const stressLines: string[] = ['Stress-test before coding:']
  stressLines.push(
    `Clarifying questions answered: ${questionReadiness.answered}/${questionReadiness.total}`,
  )
  const unansweredQuestions = renderUnansweredClarifyingQuestions(manifest)
  if (unansweredQuestions.length > 0) {
    stressLines.push(
      `Unanswered clarifying questions: ${unansweredQuestions.length}`,
      'unanswered clarifying questions:',
      ...unansweredQuestions,
    )
  }
  appendBulletSection(stressLines, 'assumptions', manifest.assumptions)
  appendBulletSection(stressLines, 'risks', manifest.risks)
  appendClarifyingQuestionSection(stressLines, manifest)

  await writer.appendBuildEvent(parsed.projectDir, parsed.buildId, {
    version: 1,
    kind: 'next_slice_prompt_rendered',
    buildId: parsed.buildId,
    tenantId: manifest.tenantId,
    t: new Date().toISOString(),
    sliceId: slice.id,
    title: slice.title,
  })

  return [
    `Build next slice: ${slice.id} ${slice.title}`,
    `Project: ${manifest.projectDir}`,
    `Build: ${manifest.buildId}`,
    `Spec: ${formatOptionalValue(manifest.specPath)}`,
    '',
    'Write the failing test first:',
    slice.testFirst,
    '',
    'Required TDD loop:',
    '1. Add or update the narrow failing test for this slice.',
    '2. Run that focused test and confirm it fails for the expected reason.',
    '3. Implement only this slice.',
    "4. Re-run the focused test, then the repo's standard verification.",
    '5. Commit the passing slice before marking it complete.',
    '',
    ...anchorLines,
    '',
    ...stressLines,
    '',
    'Then implement only this slice:',
    slice.implement,
    '',
    'Run verification before committing.',
    `After the commit, mark this slice complete with \`/kairos build-complete-slice ${manifest.projectDir} ${manifest.buildId}\`.`,
    `Track progress with \`/kairos build-progress ${manifest.projectDir} ${manifest.buildId}\`.`,
    `Check readiness with \`/kairos build-readiness ${manifest.projectDir} ${manifest.buildId}\`.`,
  ].join('\n')
}

async function handleBuildSelectNextPrompt(rest: string[]): Promise<string> {
  if (parseBuildShowArgs(rest) === null) {
    return 'Usage: /kairos build-select-next-prompt [projectDir] <buildId>'
  }
  const selection = await handleBuildSelectNext(rest)
  if (!selection.startsWith('Selected ')) {
    return selection
  }
  return handleBuildNext(rest)
}

async function handleBuildCompleteSlice(rest: string[]): Promise<string> {
  const parsed = parseBuildShowArgs(rest)
  if (parsed === null) {
    return 'Usage: /kairos build-complete-slice [projectDir] <buildId>'
  }

  const writer = await createStateWriter()
  const manifest = await writer.readBuildManifest(
    parsed.projectDir,
    parsed.buildId,
  )
  if (!manifest) {
    return [
      `No build ${parsed.buildId} found for ${parsed.projectDir}.`,
      `builds command: /kairos builds ${parsed.projectDir}`,
    ].join('\n')
  }
  if (!manifest.selectedSliceId) {
    return `No tracer slice selected for ${parsed.buildId}. Run \`/kairos build-select ${parsed.projectDir} ${parsed.buildId} <sliceId>\` first.`
  }
  const slice = manifest.tracerSlices?.find(
    candidate => candidate.id === manifest.selectedSliceId,
  )
  if (!slice) {
    return `Selected tracer slice ${manifest.selectedSliceId} is missing for ${parsed.buildId}.`
  }
  if ((manifest.completedSliceIds ?? []).includes(slice.id)) {
    return [
      `Tracer slice ${slice.id} is already complete for ${parsed.buildId}: ${slice.title}`,
      `progress command: /kairos build-progress ${parsed.projectDir} ${parsed.buildId}`,
      `readiness command: /kairos build-readiness ${parsed.projectDir} ${parsed.buildId}`,
    ].join('\n')
  }

  const updatedAt = new Date().toISOString()
  const completedSliceIds = Array.from(
    new Set([...(manifest.completedSliceIds ?? []), slice.id]),
  )
  await writer.writeBuildManifest(parsed.projectDir, {
    ...manifest,
    completedSliceIds,
    updatedAt,
  })
  await writer.appendBuildEvent(parsed.projectDir, parsed.buildId, {
    version: 1,
    kind: 'slice_completed',
    buildId: parsed.buildId,
    tenantId: manifest.tenantId,
    t: updatedAt,
    sliceId: slice.id,
    title: slice.title,
  })

  return [
    `Completed ${slice.id} for ${parsed.buildId}: ${slice.title}`,
    `progress command: /kairos build-progress ${parsed.projectDir} ${parsed.buildId}`,
    `readiness command: /kairos build-readiness ${parsed.projectDir} ${parsed.buildId}`,
    `next command: /kairos build-select-next-prompt ${parsed.projectDir} ${parsed.buildId}`,
  ].join('\n')
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
    case 'builds':
      return handleBuilds(resolveProjectDir(rest[0]))
    case 'build-show':
      return handleBuildShow(rest)
    case 'build-events':
      return handleBuildEvents(rest)
    case 'build-slices':
      return handleBuildSlices(rest)
    case 'build-select':
      return handleBuildSelect(rest)
    case 'build-select-next':
      return handleBuildSelectNext(rest)
    case 'build-select-next-prompt':
      return handleBuildSelectNextPrompt(rest)
    case 'build-next':
      return handleBuildNext(rest)
    case 'build-complete-slice':
      return handleBuildCompleteSlice(rest)
    case 'build-acceptance':
      return handleBuildAcceptance(rest)
    case 'build-questions':
      return handleBuildQuestions(rest)
    case 'build-answer':
      return handleBuildAnswer(rest)
    case 'build-redact-answer':
      return handleBuildRedactAnswer(rest)
    case 'build-erasure-report':
      return handleBuildErasureReport(rest)
    case 'build-unanswered':
      return handleBuildUnanswered(rest)
    case 'build-requirements':
      return handleBuildRequirements(rest)
    case 'build-summary':
      return handleBuildSummary(rest)
    case 'build-progress':
      return handleBuildProgress(rest)
    case 'build-readiness':
      return handleBuildReadiness(rest)
    case 'build-assumptions':
      return handleBuildAssumptions(rest)
    case 'build-risks':
      return handleBuildRisks(rest)
    case 'build-goals':
      return handleBuildGoals(rest)
    case 'build-non-goals':
      return handleBuildNonGoals(rest)
    case 'build-users':
      return handleBuildUsers(rest)
    case 'build-problem':
      return handleBuildProblem(rest)
    case 'build-traceability':
      return handleBuildTraceability(rest)
    case 'build-prd-outline':
      return handleBuildPrdOutline(rest)
    case 'build-audit-verify':
      return handleBuildAuditVerify(rest)
    case 'build-audit-export':
      return handleBuildAuditExport(rest)
    case 'build-audit-siem-export':
      return handleBuildAuditSiemExport(rest)
    case 'build-audit-export-verify':
      return handleBuildAuditExportVerify(rest)
    case 'build-audit-anchor':
      return handleBuildAuditAnchor(rest)
    case 'build-audit-anchor-verify':
      return handleBuildAuditAnchorVerify(rest)
    case 'export':
      return handleExport(rest)
    case 'import':
      return handleImport(rest)
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
    'status|list|opt-in|opt-out|demo|build|builds|build-show|build-events|build-slices|build-select|build-select-next|build-select-next-prompt|build-next|build-complete-slice|build-acceptance|build-questions|build-answer|build-redact-answer|build-erasure-report|build-unanswered|build-requirements|build-summary|build-progress|build-readiness|build-assumptions|build-risks|build-goals|build-non-goals|build-users|build-problem|build-traceability|build-prd-outline|build-audit-verify|build-audit-export|build-audit-siem-export|build-audit-export-verify|build-audit-anchor|build-audit-anchor-verify|export tenant|export tenant-verify|import tenant|pause|resume|dashboard|logs|cloud|cloud-sync|gateway|skills|skill-improvements|memory-proposals|memory',
  load: () => import('./kairos-ui.js'),
} satisfies Command

export default kairos
