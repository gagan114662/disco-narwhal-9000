import { appendFile, mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  getKairosGlobalCostsPath,
  getKairosGlobalEventsPath,
  getKairosPausePath,
  getKairosStateDir,
  getProjectKairosCostsPath,
  getProjectKairosDir,
  getProjectKairosEventsPath,
} from './paths.js'

export type ProjectStatus = {
  projectDir: string
  running: boolean
  dirty: boolean
  pendingCount: number
  lastEvent?: string
  lastRunAt?: string
  nextFireAt?: number | null
  updatedAt: string
}

export type ProjectLogEvent =
  | { kind: 'worker_started'; t: string; nextFireAt?: number | null }
  | { kind: 'worker_stopped'; t: string }
  | { kind: 'fired'; t: string; taskId: string; cron: string }
  | { kind: 'missed'; t: string; count: number }
  | { kind: 'overlap_coalesced'; t: string; taskId: string }
  | { kind: 'catchup_started'; t: string }
  | { kind: 'finished'; t: string; source: 'event' | 'catchup' }
  | { kind: 'project_registered'; t: string; projectDir: string }
  | { kind: 'project_unregistered'; t: string; projectDir: string }
  | { kind: 'skipped_paused'; t: string; taskId: string; reason: string }
  | {
      kind: 'cap_hit_notice'
      t: string
      scope: 'project' | 'global'
      cap: number
      current: number
      source: 'daemon'
      projectDir?: string
    }
  | {
      kind: 'tier3_reflection'
      t: string
      windowKey: string
      outcome:
        | 'skipped_no_allowed_tools'
        | 'skipped_hourly_cap'
        | 'skipped_paused'
        | 'noop'
        | 'surface'
        | 'invalid_output'
        | 'child_error'
      runId?: string
      enabled: true
      allowedTools?: string[]
      costUSD?: number
      numTurns?: number
      durationMs?: number
      message?: string
      errorMessage?: string
      paused?: boolean
    }
  | {
      kind: 'tier3_surface'
      t: string
      projectDir: string
      runId: string
      message: string
      source: 'daemon'
    }

export type GlobalStatus = {
  kind: 'kairos'
  state: 'starting' | 'idle' | 'stopped'
  pid: number
  startedAt: string
  updatedAt: string
  projects: number
  lastEventAt?: string
  stoppedAt?: string
}

export type CostsFile = {
  totalUSD: number
  totalTurns: number
  runs: number
  lastRunUSD?: number
  lastRunAt?: string
  updatedAt: string
}

export type PauseState = {
  paused: boolean
  reason?: 'cap_hit'
  scope?: 'project' | 'global'
  cap?: number
  current?: number
  setAt?: string
  source: 'daemon' | 'user'
}

const writeQueues = new Map<string, Promise<void>>()

async function enqueuePathWrite(
  path: string,
  writeOp: () => Promise<void>,
): Promise<void> {
  const previous = writeQueues.get(path) ?? Promise.resolve()
  const next = previous.then(writeOp)
  writeQueues.set(
    path,
    next.finally(() => {
      if (writeQueues.get(path) === next) {
        writeQueues.delete(path)
      }
    }),
  )
  await next
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await enqueuePathWrite(path, async () => {
    const tempPath = `${path}.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(tempPath, `${jsonStringify(value, null, 2)}\n`, 'utf8')
    await rename(tempPath, path)
  })
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await enqueuePathWrite(path, async () => {
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${jsonStringify(value)}\n`, 'utf8')
  })
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export type StateWriter = Awaited<ReturnType<typeof createStateWriter>>

export async function createStateWriter() {
  await mkdir(getKairosStateDir(), { recursive: true })

  return {
    async writeGlobalStatus(status: GlobalStatus): Promise<void> {
      await writeJsonAtomic(join(getKairosStateDir(), 'status.json'), status)
    },
    async appendGlobalEvent(event: ProjectLogEvent): Promise<void> {
      await appendJsonLine(getKairosGlobalEventsPath(), event)
    },
    async ensureProjectDir(projectDir: string): Promise<void> {
      await mkdir(getProjectKairosDir(projectDir), { recursive: true })
    },
    async writeProjectStatus(status: ProjectStatus): Promise<void> {
      const dir = getProjectKairosDir(status.projectDir)
      await mkdir(dir, { recursive: true })
      await writeJsonAtomic(join(dir, 'status.json'), status)
    },
    async appendProjectLog(
      projectDir: string,
      event: ProjectLogEvent,
    ): Promise<void> {
      const dir = getProjectKairosDir(projectDir)
      await mkdir(dir, { recursive: true })
      await appendJsonLine(join(dir, 'log.jsonl'), event)
    },
    async appendProjectEvent(
      projectDir: string,
      event: Record<string, unknown>,
    ): Promise<void> {
      await appendJsonLine(getProjectKairosEventsPath(projectDir), event)
    },
    async readGlobalCosts(): Promise<CostsFile | null> {
      return readJsonFile<CostsFile>(getKairosGlobalCostsPath())
    },
    async writeGlobalCosts(costs: CostsFile): Promise<void> {
      await writeJsonAtomic(getKairosGlobalCostsPath(), costs)
    },
    async readProjectCosts(projectDir: string): Promise<CostsFile | null> {
      return readJsonFile<CostsFile>(getProjectKairosCostsPath(projectDir))
    },
    async writeProjectCosts(
      projectDir: string,
      costs: CostsFile,
    ): Promise<void> {
      await writeJsonAtomic(getProjectKairosCostsPath(projectDir), costs)
    },
    async readPauseState(): Promise<PauseState | null> {
      return readJsonFile<PauseState>(getKairosPausePath())
    },
    async writePauseState(state: PauseState): Promise<void> {
      await writeJsonAtomic(getKairosPausePath(), state)
    },
    getProjectKairosDir,
  }
}
