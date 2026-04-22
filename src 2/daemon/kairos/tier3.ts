import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { z } from 'zod/v4'
import type { CronTask } from '../../utils/cronTasks.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { parseSettingsFile } from '../../utils/settings/settings.js'
import type { ChildLauncher, ChildRunResult } from './childRunner.js'
import { runChild } from './childRunner.js'
import type { CapHit, CostTracker } from './costTracker.js'
import type { StateWriter } from './stateWriter.js'

const DEFAULT_TIER3_INTERVAL_MS = 60 * 60 * 1000
const MAX_SURFACED_MESSAGE_CHARS = 280
const MAX_TIER3_TURNS = 4
const SAFE_TIER3_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS'])

const Tier3DecisionSchema = z
  .object({
    surface: z.boolean(),
    message: z.string().trim().min(1).max(MAX_SURFACED_MESSAGE_CHARS).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.surface && !value.message) {
      ctx.addIssue({
        code: 'custom',
        message: 'message is required when surface=true',
        path: ['message'],
      })
    }
  })

type Tier3Decision = z.infer<typeof Tier3DecisionSchema>

type Tier3State = {
  lastWindowKey?: string
  lastRunAt?: string
  lastOutcome?:
    | 'noop'
    | 'surface'
    | 'invalid_output'
    | 'child_error'
    | 'skipped_hourly_cap'
    | 'skipped_paused'
  lastRunId?: string
}

type Tier3Config = {
  enabled: boolean
  intervalMs: number
}

export type Tier3ReflectionOutcome =
  | 'disabled'
  | 'skipped_hourly_cap'
  | 'skipped_paused'
  | 'noop'
  | 'surface'
  | 'invalid_output'
  | 'child_error'

export type Tier3ReflectionResult = {
  outcome: Tier3ReflectionOutcome
  runResult?: ChildRunResult
  message?: string
}

type Tier3CapHitHandler = (params: {
  capHit: CapHit
  projectDir: string
  task: CronTask
}) => Promise<void>

export type RunTier3ReflectionOptions = {
  projectDir: string
  stateWriter: StateWriter
  launcher: ChildLauncher | null
  costTracker: CostTracker | null
  defaultAllowedTools: string[]
  maxTurns: number
  timeoutMs: number
  checkPaused?: () => Promise<boolean>
  handleCapHit: Tier3CapHitHandler
  now?: () => Date
}

export type Tier3Controller = {
  start(): void
  stop(): Promise<void>
}

function getTier3StatePath(projectDir: string): string {
  return join(projectDir, '.claude', 'kairos', 'tier3.json')
}

function getProjectSettingsPaths(projectDir: string): string[] {
  return [
    join(getClaudeConfigHomeDir(), 'settings.json'),
    join(projectDir, '.claude', 'settings.json'),
    join(projectDir, '.claude', 'settings.local.json'),
  ]
}

function parsePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function readTier3ConfigPartial(settings: unknown): Partial<Tier3Config> {
  if (!settings || typeof settings !== 'object') return {}
  const kairos = (settings as Record<string, unknown>).kairos
  if (!kairos || typeof kairos !== 'object') return {}
  const tier3 = (kairos as Record<string, unknown>).tier3
  if (!tier3 || typeof tier3 !== 'object') return {}

  const record = tier3 as Record<string, unknown>
  return {
    enabled:
      typeof record.enabled === 'boolean' ? record.enabled : undefined,
    intervalMs: parsePositiveNumber(record.intervalMs),
  }
}

export function getTier3WindowKey(now: Date, intervalMs: number): string {
  const bucketStartMs = Math.floor(now.getTime() / intervalMs) * intervalMs
  return new Date(bucketStartMs).toISOString()
}

export function getNextTier3DelayMs(now: Date, intervalMs: number): number {
  const remainder = now.getTime() % intervalMs
  return remainder === 0 ? intervalMs : intervalMs - remainder
}

export function computeTier3AllowedTools(
  defaultAllowedTools: string[],
): string[] {
  return defaultAllowedTools.filter(tool => SAFE_TIER3_TOOLS.has(tool))
}

async function readTier3Config(projectDir: string): Promise<Tier3Config> {
  const merged: Partial<Tier3Config> = {}
  for (const path of getProjectSettingsPaths(projectDir)) {
    const { settings } = parseSettingsFile(path)
    const partial = readTier3ConfigPartial(settings)
    if (partial.enabled !== undefined) {
      merged.enabled = partial.enabled
    }
    if (partial.intervalMs !== undefined) {
      merged.intervalMs = partial.intervalMs
    }
  }

  const envInterval = parsePositiveNumber(
    process.env.KAIROS_TIER3_INTERVAL_MS
      ? Number(process.env.KAIROS_TIER3_INTERVAL_MS)
      : undefined,
  )

  return {
    enabled: merged.enabled === true,
    intervalMs: envInterval ?? merged.intervalMs ?? DEFAULT_TIER3_INTERVAL_MS,
  }
}

async function readTier3State(projectDir: string): Promise<Tier3State> {
  try {
    const raw = await readFile(getTier3StatePath(projectDir), 'utf8')
    return JSON.parse(raw) as Tier3State
  } catch {
    return {}
  }
}

async function writeTier3State(
  projectDir: string,
  state: Tier3State,
): Promise<void> {
  const path = getTier3StatePath(projectDir)
  const tempPath = `${path}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(tempPath, path)
}

function truncateForLog(value: string | undefined, max = 160): string | undefined {
  if (!value) return undefined
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

function normalizeStructuredOutput(raw: string): string {
  return raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

export function parseTier3Decision(raw: string): Tier3Decision {
  const normalized = normalizeStructuredOutput(raw)
  return Tier3DecisionSchema.parse(JSON.parse(normalized))
}

export function buildTier3Prompt(projectDir: string, now: Date): string {
  return [
    'You are the KAIROS Tier 3 reflection runner for a local code project.',
    `Current time: ${now.toISOString()}`,
    `Project root: ${projectDir}`,
    'Goal: decide whether there is exactly one concise proactive message worth surfacing to the user right now.',
    'You may inspect local project context, especially:',
    `- ${join(projectDir, '.claude', 'kairos', 'events.jsonl')}`,
    `- ${join(projectDir, '.claude', 'kairos', 'log.jsonl')}`,
    `- ${join(projectDir, '.claude', 'scheduled_tasks.json')}`,
    'Rules:',
    '- Use at most one tool call. Prefer answering without tools if the prompt already gives enough context.',
    '- Never take actions on the user’s behalf.',
    '- Never ask to run tools or change files.',
    '- If there is no clearly useful proactive message, return surface=false.',
    `- If surface=true, message must be plain text under ${MAX_SURFACED_MESSAGE_CHARS} characters.`,
    '- Return exactly one JSON object and nothing else.',
    'Valid responses:',
    '{"surface":false}',
    '{"surface":true,"message":"..."}',
  ].join('\n')
}

function buildSyntheticTier3Task(windowKey: string): CronTask {
  return {
    id: `tier3-${windowKey}`,
    cron: '@hourly',
    prompt: 'Reflect on recent Kairos context and surface one proactive message only if justified.',
    createdAt: Date.now(),
  }
}

async function appendReflectionLog(
  stateWriter: StateWriter,
  projectDir: string,
  event: Parameters<StateWriter['appendProjectLog']>[1],
): Promise<void> {
  await stateWriter.appendProjectLog(projectDir, event)
}

export async function runTier3Reflection(
  options: RunTier3ReflectionOptions,
): Promise<Tier3ReflectionResult> {
  const now = options.now ?? (() => new Date())
  const startedAt = now()
  const config = await readTier3Config(options.projectDir)
  if (!config.enabled || !options.launcher) {
    return { outcome: 'disabled' }
  }

  const windowKey = getTier3WindowKey(startedAt, config.intervalMs)

  if (options.checkPaused && (await options.checkPaused())) {
    await appendReflectionLog(options.stateWriter, options.projectDir, {
      kind: 'tier3_reflection',
      t: startedAt.toISOString(),
      windowKey,
      outcome: 'skipped_paused',
      enabled: true,
      paused: true,
    })
    return { outcome: 'skipped_paused' }
  }

  const existingState = await readTier3State(options.projectDir)
  if (existingState.lastWindowKey === windowKey) {
    await appendReflectionLog(options.stateWriter, options.projectDir, {
      kind: 'tier3_reflection',
      t: startedAt.toISOString(),
      windowKey,
      outcome: 'skipped_hourly_cap',
      enabled: true,
    })
    return { outcome: 'skipped_hourly_cap' }
  }

  await writeTier3State(options.projectDir, {
    lastWindowKey: windowKey,
    lastRunAt: startedAt.toISOString(),
  })

  const allowedTools = computeTier3AllowedTools(options.defaultAllowedTools)
  const runResult = await runChild(
    {
      taskId: `tier3:${windowKey}`,
      prompt: buildTier3Prompt(options.projectDir, startedAt),
      projectDir: options.projectDir,
      allowedTools,
      maxTurns: Math.max(1, Math.min(options.maxTurns, MAX_TIER3_TURNS)),
      timeoutMs: options.timeoutMs,
    },
    {
      launcher: options.launcher,
      now,
      onEvent: event =>
        options.stateWriter.appendProjectEvent(options.projectDir, {
          ...event,
          source: 'tier3',
          windowKey,
        }),
    },
  )

  let paused = false
  if (options.costTracker) {
    const { capHit } = await options.costTracker.record({
      projectDir: options.projectDir,
      taskId: `tier3:${windowKey}`,
      runId: runResult.runId,
      costUSD: runResult.costUSD,
      numTurns: runResult.numTurns,
      durationMs: runResult.durationMs,
    })
    if (capHit) {
      await options.handleCapHit({
        capHit,
        projectDir: options.projectDir,
        task: buildSyntheticTier3Task(windowKey),
      })
      paused = true
    }
  }

  if (!runResult.ok) {
    await appendReflectionLog(options.stateWriter, options.projectDir, {
      kind: 'tier3_reflection',
      t: now().toISOString(),
      windowKey,
      outcome: 'child_error',
      enabled: true,
      runId: runResult.runId,
      allowedTools,
      costUSD: runResult.costUSD,
      numTurns: runResult.numTurns,
      durationMs: runResult.durationMs,
      errorMessage: runResult.errorMessage,
      paused,
    })
    await writeTier3State(options.projectDir, {
      lastWindowKey: windowKey,
      lastRunAt: startedAt.toISOString(),
      lastOutcome: 'child_error',
      lastRunId: runResult.runId,
    })
    return { outcome: 'child_error', runResult }
  }

  if (!runResult.lastAssistantText) {
    await appendReflectionLog(options.stateWriter, options.projectDir, {
      kind: 'tier3_reflection',
      t: now().toISOString(),
      windowKey,
      outcome: 'invalid_output',
      enabled: true,
      runId: runResult.runId,
      allowedTools,
      costUSD: runResult.costUSD,
      numTurns: runResult.numTurns,
      durationMs: runResult.durationMs,
      errorMessage: 'missing structured assistant output',
      paused,
    })
    await writeTier3State(options.projectDir, {
      lastWindowKey: windowKey,
      lastRunAt: startedAt.toISOString(),
      lastOutcome: 'invalid_output',
      lastRunId: runResult.runId,
    })
    return { outcome: 'invalid_output', runResult }
  }

  let decision: Tier3Decision
  try {
    decision = parseTier3Decision(runResult.lastAssistantText)
  } catch (error) {
    await appendReflectionLog(options.stateWriter, options.projectDir, {
      kind: 'tier3_reflection',
      t: now().toISOString(),
      windowKey,
      outcome: 'invalid_output',
      enabled: true,
      runId: runResult.runId,
      allowedTools,
      costUSD: runResult.costUSD,
      numTurns: runResult.numTurns,
      durationMs: runResult.durationMs,
      errorMessage: truncateForLog(
        error instanceof Error ? error.message : String(error),
      ),
      message: truncateForLog(runResult.lastAssistantText),
      paused,
    })
    await writeTier3State(options.projectDir, {
      lastWindowKey: windowKey,
      lastRunAt: startedAt.toISOString(),
      lastOutcome: 'invalid_output',
      lastRunId: runResult.runId,
    })
    return { outcome: 'invalid_output', runResult }
  }

  if (!decision.surface) {
    await appendReflectionLog(options.stateWriter, options.projectDir, {
      kind: 'tier3_reflection',
      t: now().toISOString(),
      windowKey,
      outcome: 'noop',
      enabled: true,
      runId: runResult.runId,
      allowedTools,
      costUSD: runResult.costUSD,
      numTurns: runResult.numTurns,
      durationMs: runResult.durationMs,
      paused,
    })
    await writeTier3State(options.projectDir, {
      lastWindowKey: windowKey,
      lastRunAt: startedAt.toISOString(),
      lastOutcome: 'noop',
      lastRunId: runResult.runId,
    })
    return { outcome: 'noop', runResult }
  }

  const surfaceEvent = {
    kind: 'tier3_surface' as const,
    t: now().toISOString(),
    projectDir: options.projectDir,
    runId: runResult.runId,
    message: decision.message!,
    source: 'daemon' as const,
  }
  await options.stateWriter.appendProjectEvent(options.projectDir, surfaceEvent)
  await options.stateWriter.appendGlobalEvent(surfaceEvent)
  await appendReflectionLog(options.stateWriter, options.projectDir, {
    kind: 'tier3_reflection',
    t: surfaceEvent.t,
    windowKey,
    outcome: 'surface',
    enabled: true,
    runId: runResult.runId,
    allowedTools,
    costUSD: runResult.costUSD,
    numTurns: runResult.numTurns,
    durationMs: runResult.durationMs,
    message: decision.message,
    paused,
  })
  await writeTier3State(options.projectDir, {
    lastWindowKey: windowKey,
    lastRunAt: startedAt.toISOString(),
    lastOutcome: 'surface',
    lastRunId: runResult.runId,
  })
  return { outcome: 'surface', runResult, message: decision.message }
}

export function createTier3Controller(
  options: RunTier3ReflectionOptions,
): Tier3Controller {
  const now = options.now ?? (() => new Date())
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const scheduleNext = async (): Promise<void> => {
    if (stopped) return
    const config = await readTier3Config(options.projectDir)
    const delayMs = getNextTier3DelayMs(now(), config.intervalMs)
    timer = setTimeout(() => {
      timer = null
      inFlight = (async () => {
        try {
          await runTier3Reflection(options)
        } finally {
          inFlight = null
          await scheduleNext()
        }
      })()
    }, delayMs)
    timer.unref?.()
  }

  return {
    start() {
      void scheduleNext()
    },
    async stop() {
      stopped = true
      clearTimer()
      await inFlight
    },
  }
}
