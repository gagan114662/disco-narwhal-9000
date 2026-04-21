import { appendFile, mkdir, writeFile } from 'fs/promises'
import type { Writable } from 'stream'
import { createProjectRegistry } from './projectRegistry.js'
import { createProjectWorker } from './projectWorker.js'
import { getKairosStateDir, getKairosStatusPath, getKairosStdoutLogPath } from './paths.js'
import { createStateWriter } from './stateWriter.js'

type KairosStatus = {
  kind: 'kairos'
  state: 'starting' | 'idle' | 'stopped'
  pid: number
  startedAt: string
  updatedAt: string
  stoppedAt?: string
}

export type RunKairosWorkerOptions = {
  signal?: AbortSignal
  stdout?: Pick<Writable, 'write'>
  now?: () => Date
  pid?: number
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
    const worker = createProjectWorker(projectDir, {
      stateWriter,
      now,
    })
    activeWorkers.set(projectDir, worker)
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
