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
import {
  createDraftBuild,
  type CreateDraftBuildDeps,
} from '../daemon/kairos/draftBuild.js'
import type {
  KairosBuildEvent,
  KairosBuildManifest,
  KairosBuildTracerSlice,
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
  'agent_event_recorded',
  'build_result_written',
  'build_failed',
]
const KAIROS_BUILD_EVENT_KINDS = new Set<KairosBuildEventKind>(
  KAIROS_BUILD_EVENT_KIND_LIST,
)
const BUILD_EVENTS_USAGE =
  'Usage: /kairos build-events [projectDir] <buildId> [lines] [--kind <kind>]'

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
    ...builds.map(
      build => {
        const title = build.title ? ` ${build.title}` : ''
        const selected = build.selectedSliceId
          ? ` selected=${build.selectedSliceId}`
          : ''
        return `- ${build.buildId} [${build.status}]${title}${selected} updated=${build.updatedAt}`
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
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
    '--- spec ---',
    spec ?? '(spec not found)',
  ].join('\n')
}

function formatBuildEvent(event: KairosBuildEvent): string {
  switch (event.kind) {
    case 'build_created':
      return `${event.t} build_created status=${event.status}`
    case 'build_status_changed':
      return `${event.t} build_status_changed ${event.from}->${event.to}`
    case 'spec_written':
      return `${event.t} spec_written spec=${event.specPath}`
    case 'slice_selected':
      return `${event.t} slice_selected slice=${event.sliceId} title=${event.title}`
    case 'next_slice_prompt_rendered':
      return `${event.t} next_slice_prompt_rendered slice=${event.sliceId} title=${event.title}`
    case 'slice_completed':
      return `${event.t} slice_completed slice=${event.sliceId} title=${event.title}`
    case 'clarifying_question_answered':
      return `${event.t} clarifying_question_answered question=${event.questionNumber} answer=${event.answer}`
    case 'agent_event_recorded':
      return `${event.t} agent_event_recorded run=${event.runId} event=${event.eventKind}`
    case 'build_result_written':
      return `${event.t} build_result_written status=${event.status} result=${event.resultPath}`
    case 'build_failed':
      return `${event.t} build_failed error=${event.errorMessage}`
  }
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
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
  ].join('\n')
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
  }
  if (!manifest.acceptanceChecks || manifest.acceptanceChecks.length === 0) {
    return `No acceptance checks found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Acceptance checks for ${parsed.buildId}:`,
    ...manifest.acceptanceChecks.map(check => `- ${check}`),
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
  }
  if (!manifest.clarifyingQuestions || manifest.clarifyingQuestions.length === 0) {
    return `No clarifying questions found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Clarifying questions for ${parsed.buildId}:`,
    ...renderClarifyingQuestions(manifest),
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
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
    answer: parsed.answer,
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
  }
  const events = await writer.readBuildEvents(parsed.projectDir, parsed.buildId)
  const latestEvent = events.at(-1)
  const latestEventLabel = latestEvent
    ? `${latestEvent.kind} at ${latestEvent.t}`
    : '—'
  const questionReadiness = countAnsweredClarifyingQuestions(manifest)

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
    `assumptions: ${manifest.assumptions?.length ?? 0}`,
    `risks: ${manifest.risks?.length ?? 0}`,
    `tracer slices: ${manifest.tracerSlices?.length ?? 0}`,
    `completed slices: ${manifest.completedSliceIds?.length ?? 0}`,
    `traceability seeds: ${manifest.traceabilitySeeds?.length ?? 0}`,
    `last event: ${latestEventLabel}`,
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
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
    `selected slice: ${formatOptionalValue(manifest.selectedSliceId)}`,
    `completed slices: ${completedCount}/${totalCount}`,
    `remaining slices: ${remainingCount}`,
    `next slice: ${nextSliceLabel}`,
    `next command: ${nextCommand}`,
    ...manifest.tracerSlices.map(slice =>
      formatTracerSliceProgress(
        slice,
        completedSliceIds,
        manifest.selectedSliceId,
      ),
    ),
  ].join('\n')
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
  }

  const events = await writer.readBuildEvents(parsed.projectDir, parsed.buildId)
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
  const blockers = [
    ...(hasIncompleteSlice && !selectedSliceIsIncomplete
      ? ['Select an incomplete tracer slice before running build-next.']
      : []),
    ...unansweredQuestions,
  ]
  const blockerLines =
    blockers.length > 0
      ? ['blockers:', ...blockers.map(blocker => `- ${blocker}`)]
      : ['blockers: none']
  const readinessState = blockers.length > 0 ? 'blocked' : 'ready'

  return [
    `Build readiness for ${parsed.buildId}:`,
    `readiness: ${readinessState}`,
    `selected slice: ${selectedSliceLabel}`,
    `completed slices: ${completedSlices}/${totalSlices}`,
    `clarifying questions answered: ${questionReadiness.answered}/${questionReadiness.total}`,
    `unanswered clarifying questions: ${unansweredQuestions.length}`,
    `last event: ${latestEventLabel}`,
    `next command: ${nextCommand}`,
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
  }
  if (!manifest.users || manifest.users.length === 0) {
    return `No users found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Users for ${parsed.buildId}:`,
    ...manifest.users.map(user => `- ${user}`),
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
  }
  if (!manifest.problem) {
    return `No problem statement found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [`Problem for ${parsed.buildId}:`, manifest.problem].join('\n')
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
  }
  if (!manifest.traceabilitySeeds || manifest.traceabilitySeeds.length === 0) {
    return `No traceability seeds found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Traceability seeds for ${parsed.buildId}:`,
    ...manifest.traceabilitySeeds.map(
      seed => `- ${seed.id} [${seed.source}] ${seed.text}`,
    ),
  ].join('\n')
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
  }
  if (!manifest.goals || manifest.goals.length === 0) {
    return `No goals found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Goals for ${parsed.buildId}:`,
    ...manifest.goals.map(goal => `- ${goal}`),
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
  }
  if (!manifest.nonGoals || manifest.nonGoals.length === 0) {
    return `No non-goals found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Non-goals for ${parsed.buildId}:`,
    ...manifest.nonGoals.map(nonGoal => `- ${nonGoal}`),
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
  }
  if (!manifest.assumptions || manifest.assumptions.length === 0) {
    return `No assumptions found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Assumptions for ${parsed.buildId}:`,
    ...manifest.assumptions.map(assumption => `- ${assumption}`),
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
  }
  if (!manifest.risks || manifest.risks.length === 0) {
    return `No risks found for ${parsed.buildId} in ${parsed.projectDir}.`
  }

  return [
    `Risks for ${parsed.buildId}:`,
    ...manifest.risks.map(risk => `- ${risk}`),
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
  }
  const slice = manifest.tracerSlices?.find(
    candidate => candidate.id === parsed.sliceId,
  )
  if (!slice) {
    return `No tracer slice ${parsed.sliceId} found for ${parsed.buildId}.`
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
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
    if (completedSliceIds.size > 0) {
      const after = manifest.selectedSliceId ?? 'the beginning'
      return `No incomplete tracer slice found after ${after} for ${parsed.buildId}.`
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
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
    return `No build ${parsed.buildId} found for ${parsed.projectDir}.`
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
    return `Tracer slice ${slice.id} is already complete for ${parsed.buildId}: ${slice.title}`
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

  return `Completed ${slice.id} for ${parsed.buildId}: ${slice.title}`
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
    'status|list|opt-in|opt-out|demo|build|builds|build-show|build-events|build-slices|build-select|build-select-next|build-select-next-prompt|build-next|build-complete-slice|build-acceptance|build-questions|build-answer|build-unanswered|build-requirements|build-summary|build-progress|build-readiness|build-assumptions|build-risks|build-goals|build-non-goals|build-users|build-problem|build-traceability|build-prd-outline|pause|resume|dashboard|logs|cloud|cloud-sync|gateway|skills|skill-improvements|memory-proposals|memory',
  load: () => import('./kairos-ui.js'),
} satisfies Command

export default kairos
