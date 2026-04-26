import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from 'fs/promises'
import { dirname, join } from 'path'
import { jsonStringify } from '../../utils/slowOperations.js'
import { calculateKairosBuildEventAuditHash } from './buildAudit.js'
import {
  parseKairosBuildEvent,
  parseKairosBuildManifest,
  parseKairosBuildResult,
  type KairosBuildEvent,
  type KairosBuildManifest,
  type KairosBuildResult,
} from './buildState.js'
import {
  getKairosGlobalCostsPath,
  getKairosGlobalEventsPath,
  getKairosPausePath,
  getKairosStateDir,
  getProjectKairosBuildDir,
  getProjectKairosBuildEventsPath,
  getProjectKairosBuildManifestPath,
  getProjectKairosBuildsDir,
  getProjectKairosBuildResultPath,
  getProjectKairosBuildSpecPath,
  getProjectKairosBuildTranscriptPointerPath,
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
  | {
      kind: 'auth_failure'
      t: string
      projectDir: string
      taskId: string
      runId: string
      notice: string
      errorMessage: string
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
  reason?: 'cap_hit' | 'auth_failure'
  scope?: 'project' | 'global'
  cap?: number
  current?: number
  setAt?: string
  source: 'daemon' | 'user'
  /** Human-readable notice shown to the user when the daemon pauses itself. */
  notice?: string
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

function readLastBuildEventHash(raw: string): string | null {
  const lastLine = raw
    .split(/\r?\n/)
    .reverse()
    .find(line => line.trim().length > 0)
  if (!lastLine) return null
  const event = parseKairosBuildEvent(JSON.parse(lastLine))
  return event.auditHash ?? null
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function assertBuildIdMatchesPath(buildId: string, pathBuildId: string): void {
  if (buildId !== pathBuildId) {
    throw new Error(
      `KAIROS build state buildId ${buildId} does not match path build id ${pathBuildId}`,
    )
  }
}

function assertProjectDirMatchesPath(
  projectDir: string,
  pathProjectDir: string,
): void {
  if (projectDir !== pathProjectDir) {
    throw new Error(
      `KAIROS build manifest projectDir ${projectDir} does not match path projectDir ${pathProjectDir}`,
    )
  }
}

export type StateWriter = Awaited<ReturnType<typeof createStateWriter>>

function redactBuildEventForStorage(event: KairosBuildEvent): KairosBuildEvent {
  switch (event.kind) {
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
    async ensureBuildDir(projectDir: string, buildId: string): Promise<void> {
      await mkdir(getProjectKairosBuildDir(projectDir, buildId), {
        recursive: true,
      })
    },
    async writeBuildManifest(
      projectDir: string,
      manifest: KairosBuildManifest,
    ): Promise<void> {
      const parsed = parseKairosBuildManifest(manifest)
      assertProjectDirMatchesPath(parsed.projectDir, projectDir)
      await writeJsonAtomic(
        getProjectKairosBuildManifestPath(projectDir, parsed.buildId),
        parsed,
      )
    },
    async readBuildManifest(
      projectDir: string,
      buildId: string,
    ): Promise<KairosBuildManifest | null> {
      const raw = await readJsonFile<unknown>(
        getProjectKairosBuildManifestPath(projectDir, buildId),
      )
      if (raw === null) return null
      return parseKairosBuildManifest(raw)
    },
    async listBuildManifests(
      projectDir: string,
    ): Promise<KairosBuildManifest[]> {
      let entries: string[]
      try {
        entries = await readdir(getProjectKairosBuildsDir(projectDir))
      } catch {
        return []
      }

      const manifests = await Promise.all(
        entries.map(async buildId => {
          try {
            const raw = await readJsonFile<unknown>(
              getProjectKairosBuildManifestPath(projectDir, buildId),
            )
            return raw === null ? null : parseKairosBuildManifest(raw)
          } catch {
            return null
          }
        }),
      )

      return manifests
        .filter((manifest): manifest is KairosBuildManifest => manifest !== null)
        .sort((a, b) => {
          const byUpdated = b.updatedAt.localeCompare(a.updatedAt)
          return byUpdated === 0 ? a.buildId.localeCompare(b.buildId) : byUpdated
        })
    },
    async writeBuildSpec(
      projectDir: string,
      buildId: string,
      spec: string,
    ): Promise<void> {
      const path = getProjectKairosBuildSpecPath(projectDir, buildId)
      await enqueuePathWrite(path, async () => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, spec, 'utf8')
      })
    },
    async readBuildSpec(
      projectDir: string,
      buildId: string,
    ): Promise<string | null> {
      try {
        return await readFile(
          getProjectKairosBuildSpecPath(projectDir, buildId),
          'utf8',
        )
      } catch {
        return null
      }
    },
    async appendBuildEvent(
      projectDir: string,
      buildId: string,
      event: KairosBuildEvent,
    ): Promise<void> {
      const parsed = parseKairosBuildEvent(event)
      assertBuildIdMatchesPath(parsed.buildId, buildId)
      const eventForStorage = redactBuildEventForStorage(parsed)
      const path = getProjectKairosBuildEventsPath(projectDir, buildId)
      await enqueuePathWrite(path, async () => {
        let raw = ''
        try {
          raw = await readFile(path, 'utf8')
        } catch {
          raw = ''
        }
        const eventWithPrevHash = {
          ...eventForStorage,
          auditPrevHash: readLastBuildEventHash(raw),
          auditHash: undefined,
        }
        const eventWithHash = {
          ...eventWithPrevHash,
          auditHash: calculateKairosBuildEventAuditHash(eventWithPrevHash),
        }
        await mkdir(dirname(path), { recursive: true })
        await appendFile(path, `${jsonStringify(eventWithHash)}\n`, 'utf8')
      })
    },
    async readBuildEvents(
      projectDir: string,
      buildId: string,
    ): Promise<KairosBuildEvent[]> {
      let raw: string
      try {
        raw = await readFile(
          getProjectKairosBuildEventsPath(projectDir, buildId),
          'utf8',
        )
      } catch {
        return []
      }
      return raw
        .split(/\r?\n/)
        .filter(line => line.trim().length > 0)
        .map(line => parseKairosBuildEvent(JSON.parse(line)))
    },
    async writeBuildTranscriptPointer(
      projectDir: string,
      buildId: string,
      sessionId: string,
    ): Promise<void> {
      const path = getProjectKairosBuildTranscriptPointerPath(projectDir, buildId)
      await enqueuePathWrite(path, async () => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, `${sessionId}\n`, 'utf8')
      })
    },
    async writeBuildResult(
      projectDir: string,
      buildId: string,
      result: KairosBuildResult,
    ): Promise<void> {
      const parsed = parseKairosBuildResult(result)
      assertBuildIdMatchesPath(parsed.buildId, buildId)
      await writeJsonAtomic(
        getProjectKairosBuildResultPath(projectDir, buildId),
        parsed,
      )
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
