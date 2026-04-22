import { appendFile, mkdir, writeFile } from 'fs/promises'
import type { Writable } from 'stream'
import type {
  ChildLauncher,
  ChildRunResult,
} from './childRunner.js'
import {
  AUTH_FAILURE_NOTICE,
  createSdkChildLauncher,
  runChild,
} from './childRunner.js'
import {
  createCostTracker,
  type CapHit,
  type CostCaps,
  type CostTracker,
} from './costTracker.js'
import { createProjectRegistry } from './projectRegistry.js'
import { createProjectWorker } from './projectWorker.js'
import type { CronTask } from '../../utils/cronTasks.js'
import {
  getKairosStateDir,
  getKairosStatusPath,
  getKairosStdoutLogPath,
} from './paths.js'
import { createStateWriter, type StateWriter } from './stateWriter.js'
import { createTier3Controller, type Tier3Controller } from './tier3.js'

type KairosStatus = {
  kind: 'kairos'
  state: 'starting' | 'idle' | 'stopped'
  pid: number
  startedAt: string
  updatedAt: string
  stoppedAt?: string
}

const DEFAULT_ALLOWED_TOOLS = ['Read']

function parseNumberEnv(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseAllowedToolsEnv(value: string | undefined): string[] | undefined {
  if (value === undefined || value === '') return undefined
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

export type RunKairosWorkerOptions = {
  signal?: AbortSignal
  stdout?: Pick<Writable, 'write'>
  now?: () => Date
  pid?: number
  /**
   * When provided, fired tasks spawn a child Claude run via this launcher.
   * When omitted and `enableChildRuns` is false, fired tasks are still
   * logged but no external run is made. Defaults to the SDK-backed launcher.
   */
  childLauncher?: ChildLauncher
  /**
   * Explicit opt-out switch. Tests use this to keep the worker's old
   * no-child-run behavior without also having to stub the launcher.
   */
  enableChildRuns?: boolean
  caps?: CostCaps
  allowedTools?: string[]
  maxTurns?: number
  timeoutMs?: number
}

function formatLogLine(message: string, now: Date, pid: number): string {
  return `[${now.toISOString()}] [kairos] pid=${pid} ${message}\n`
}

async function writeStatus(status: KairosStatus): Promise<void> {
  await writeFile(getKairosStatusPath(), `${JSON.stringify(status, null, 2)}\n`)
}

async function logLine(
  message: string,
  {
    stdout = process.stdout,
    now = new Date(),
    pid = process.pid,
  }: {
    stdout?: Pick<Writable, 'write'>
    now?: Date
    pid?: number
  },
): Promise<void> {
  const line = formatLogLine(message, now, pid)
  stdout.write(line)
  await appendFile(getKairosStdoutLogPath(), line)
}

function waitForAbort(signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise(() => {})
  }
  if (signal.aborted) {
    return Promise.resolve()
  }
  return new Promise(resolve => {
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

/**
 * Computes the effective tool allowlist applied at child spawn time.
 * A future phase can thread per-task overrides through here; for now
 * every task gets the same daemon-level allowlist so the child cannot
 * exceed what the operator opted into.
 */
export function computeEffectiveAllowedTools(
  defaults: string[],
  _task: CronTask,
): string[] {
  return [...defaults]
}

type CapHitHandler = (params: {
  capHit: CapHit
  projectDir: string
  task: CronTask
}) => Promise<void>

/**
 * Handle the cap-hit path **without** starting a recursive child run.
 * The daemon itself writes the notice directly to global events.jsonl and
 * flips pause.json. Anything watching those files (e.g. the dashboard from
 * Phase 4) picks up the state change.
 */
export function makeCapHitHandler(
  stateWriter: StateWriter,
  now: () => Date,
): CapHitHandler {
  return async ({ capHit, projectDir, task }) => {
    const t = now().toISOString()
    await stateWriter.writePauseState({
      paused: true,
      reason: 'cap_hit',
      scope: capHit.scope,
      cap: capHit.cap,
      current: capHit.current,
      setAt: t,
      source: 'daemon',
    })
    await stateWriter.appendGlobalEvent({
      kind: 'cap_hit_notice',
      t,
      scope: capHit.scope,
      cap: capHit.cap,
      current: capHit.current,
      source: 'daemon',
      projectDir: capHit.scope === 'project' ? projectDir : undefined,
    })
    await stateWriter.appendProjectEvent(projectDir, {
      kind: 'cap_hit_notice',
      t,
      scope: capHit.scope,
      cap: capHit.cap,
      current: capHit.current,
      source: 'daemon',
      taskId: task.id,
    })
  }
}

type AuthFailureHandler = (params: {
  projectDir: string
  task: CronTask
  result: ChildRunResult
}) => Promise<void>

/**
 * Auth failures come from the user's Keychain no longer letting the daemon
 * use the claude binary — usually after an auto-update. Retrying inside the
 * daemon can't possibly help (the ACL re-prompt needs an interactive UI),
 * so we flip global pause state with a descriptive reason. The `/kairos
 * status` command reads pause.json and surfaces the notice verbatim.
 */
export function makeAuthFailureHandler(
  stateWriter: StateWriter,
  now: () => Date,
): AuthFailureHandler {
  return async ({ projectDir, task, result }) => {
    const t = now().toISOString()
    await stateWriter.writePauseState({
      paused: true,
      reason: 'auth_failure',
      scope: 'global',
      setAt: t,
      source: 'daemon',
      notice: AUTH_FAILURE_NOTICE,
    })
    await stateWriter.appendGlobalEvent({
      kind: 'auth_failure',
      t,
      projectDir,
      taskId: task.id,
      runId: result.runId,
      notice: AUTH_FAILURE_NOTICE,
      errorMessage: result.errorMessage ?? 'unknown',
      source: 'daemon',
    })
    await stateWriter.appendProjectEvent(projectDir, {
      kind: 'auth_failure',
      t,
      taskId: task.id,
      runId: result.runId,
      notice: AUTH_FAILURE_NOTICE,
      errorMessage: result.errorMessage ?? 'unknown',
      source: 'daemon',
    })
  }
}

export type RunFiredTaskOptions = {
  projectDir: string
  stateWriter: StateWriter
  costTracker: CostTracker | null
  launcher: ChildLauncher | null
  defaultAllowedTools: string[]
  maxTurns: number
  timeoutMs: number
  handleCapHit: CapHitHandler
  handleAuthFailure?: AuthFailureHandler
  now: () => Date
}

export function makeRunFiredTask(options: RunFiredTaskOptions) {
  const {
    projectDir,
    stateWriter,
    costTracker,
    launcher,
    defaultAllowedTools,
    maxTurns,
    timeoutMs,
    handleCapHit,
    handleAuthFailure,
    now,
  } = options

  return async function runFiredTask(
    task: CronTask,
    source: 'event' | 'catchup',
  ): Promise<{ ok: boolean; paused: boolean; result?: ChildRunResult }> {
    if (!launcher) {
      return { ok: true, paused: false }
    }

    const allowedTools = computeEffectiveAllowedTools(defaultAllowedTools, task)

    const result = await runChild(
      {
        taskId: task.id,
        prompt: task.prompt,
        projectDir,
        allowedTools,
        maxTurns,
        timeoutMs,
      },
      {
        launcher,
        now,
        onEvent: event =>
          stateWriter.appendProjectEvent(projectDir, {
            ...event,
            source,
            taskId: task.id,
          }),
      },
    )

    let paused = false

    // Auth failures take precedence over cost accounting: the run didn't
    // actually consume a cap, and the daemon must stop spawning new children
    // immediately so every queued task doesn't burn a fresh Keychain
    // re-prompt on a sleeping user's machine.
    if (result.exitReason === 'auth_failure' && handleAuthFailure) {
      await handleAuthFailure({ projectDir, task, result })
      return { ok: false, paused: true, result }
    }

    if (costTracker) {
      const { capHit } = await costTracker.record({
        projectDir,
        taskId: task.id,
        runId: result.runId,
        costUSD: result.costUSD,
        numTurns: result.numTurns,
        durationMs: result.durationMs,
      })
      if (capHit) {
        await handleCapHit({ capHit, projectDir, task })
        paused = true
      }
    }

    return { ok: result.ok, paused, result }
  }
}

export async function runKairosWorker(
  options: RunKairosWorkerOptions = {},
): Promise<number> {
  const now = options.now ?? (() => new Date())
  const pid = options.pid ?? process.pid
  const startedAt = now().toISOString()

  await mkdir(getKairosStateDir(), { recursive: true })
  const stateWriter = await createStateWriter()
  const projectRegistry = await createProjectRegistry()
  const activeWorkers = new Map<
    string,
    ReturnType<typeof createProjectWorker>
  >()
  const tier3Controllers = new Map<string, Tier3Controller>()

  const enableChildRuns = options.enableChildRuns ?? true
  const launcher: ChildLauncher | null = enableChildRuns
    ? options.childLauncher ?? createSdkChildLauncher()
    : null

  const caps: CostCaps = options.caps ?? {
    perProjectUSD: parseNumberEnv(process.env.KAIROS_COST_CAP_PROJECT_USD),
    globalUSD: parseNumberEnv(process.env.KAIROS_COST_CAP_GLOBAL_USD),
  }
  const costTracker =
    caps.perProjectUSD !== undefined || caps.globalUSD !== undefined
      ? createCostTracker({ caps, stateWriter, now })
      : null

  const defaultAllowedTools =
    options.allowedTools ??
    parseAllowedToolsEnv(process.env.KAIROS_ALLOWED_TOOLS) ??
    DEFAULT_ALLOWED_TOOLS
  const maxTurns =
    options.maxTurns ?? parseNumberEnv(process.env.KAIROS_MAX_TURNS) ?? 3
  const timeoutMs =
    options.timeoutMs ??
    parseNumberEnv(process.env.KAIROS_TIMEOUT_MS) ??
    2 * 60 * 1000

  const handleCapHit = makeCapHitHandler(stateWriter, now)
  const handleAuthFailure = makeAuthFailureHandler(stateWriter, now)
  const checkPaused = async (): Promise<boolean> => {
    const state = await stateWriter.readPauseState()
    return !!state?.paused
  }

  const syncGlobalStatus = async (state: 'starting' | 'idle' | 'stopped') => {
    await stateWriter.writeGlobalStatus({
      kind: 'kairos',
      state,
      pid,
      startedAt,
      updatedAt: now().toISOString(),
      ...(state === 'stopped' ? { stoppedAt: now().toISOString() } : {}),
      projects: activeWorkers.size,
      ...(activeWorkers.size > 0 ? { lastEventAt: now().toISOString() } : {}),
    })
  }

  const addProject = async (projectDir: string) => {
    if (activeWorkers.has(projectDir)) return
    await stateWriter.ensureProjectDir(projectDir)
    const runFiredTask = makeRunFiredTask({
      projectDir,
      stateWriter,
      costTracker,
      launcher,
      defaultAllowedTools,
      maxTurns,
      timeoutMs,
      handleCapHit,
      handleAuthFailure,
      now,
    })
    const worker = createProjectWorker(projectDir, {
      stateWriter,
      now,
      runFiredTask,
      checkPaused,
    })
    activeWorkers.set(projectDir, worker)
    if (launcher) {
      const tier3 = createTier3Controller({
        projectDir,
        stateWriter,
        launcher,
        costTracker,
        defaultAllowedTools,
        maxTurns,
        timeoutMs,
        handleCapHit,
        now,
        checkPaused,
        onSurface: async ({ projectDir, message }) => {
          await logLine(
            `[tier3] project=${projectDir} surfaced=${JSON.stringify(message)}`,
            {
              stdout: options.stdout,
              now: now(),
              pid,
            },
          )
        },
      })
      tier3Controllers.set(projectDir, tier3)
      tier3.start()
    }
    await stateWriter.appendGlobalEvent({
      kind: 'project_registered',
      t: now().toISOString(),
      projectDir,
    })
    worker.start()
    await syncGlobalStatus('idle')
  }

  const removeProject = async (projectDir: string) => {
    const worker = activeWorkers.get(projectDir)
    if (!worker) return
    activeWorkers.delete(projectDir)
    const tier3 = tier3Controllers.get(projectDir)
    tier3Controllers.delete(projectDir)
    await tier3?.stop()
    await worker.stop()
    await stateWriter.appendGlobalEvent({
      kind: 'project_unregistered',
      t: now().toISOString(),
      projectDir,
    })
    await syncGlobalStatus('idle')
  }

  await writeStatus({
    kind: 'kairos',
    state: 'starting',
    pid,
    startedAt,
    updatedAt: startedAt,
  })
  await syncGlobalStatus('starting')
  await logLine('startup complete; entering idle loop', {
    stdout: options.stdout,
    now: now(),
    pid,
  })

  for (const projectDir of await projectRegistry.read()) {
    await addProject(projectDir)
  }

  const stopWatchingProjects = await projectRegistry.watch(change => {
    for (const projectDir of change.added) {
      void addProject(projectDir)
    }
    for (const projectDir of change.removed) {
      void removeProject(projectDir)
    }
  })

  const idleAt = now().toISOString()
  await writeStatus({
    kind: 'kairos',
    state: 'idle',
    pid,
    startedAt,
    updatedAt: idleAt,
  })
  await syncGlobalStatus('idle')

  await waitForAbort(options.signal)

  await stopWatchingProjects()
  for (const projectDir of [...activeWorkers.keys()]) {
    await removeProject(projectDir)
  }

  const stoppedAt = now().toISOString()
  await logLine('shutdown requested; exiting cleanly', {
    stdout: options.stdout,
    now: now(),
    pid,
  })
  await writeStatus({
    kind: 'kairos',
    state: 'stopped',
    pid,
    startedAt,
    updatedAt: stoppedAt,
    stoppedAt,
  })
  await syncGlobalStatus('stopped')

  return 0
}
