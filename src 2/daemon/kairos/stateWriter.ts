import { appendFile, mkdir, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getKairosStateDir } from './paths.js'

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

function getProjectKairosDir(projectDir: string): string {
  return join(projectDir, '.claude', 'kairos')
}

export async function createStateWriter() {
  await mkdir(getKairosStateDir(), { recursive: true })

  return {
    async writeGlobalStatus(status: GlobalStatus): Promise<void> {
      await writeJsonAtomic(join(getKairosStateDir(), 'status.json'), status)
    },
    async appendGlobalEvent(event: ProjectLogEvent): Promise<void> {
      await appendJsonLine(join(getKairosStateDir(), 'events.jsonl'), event)
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
    getProjectKairosDir,
  }
}
