import { appendFile, mkdir, writeFile } from 'fs/promises'
import type { Writable } from 'stream'
import { getKairosStateDir, getKairosStatusPath, getKairosStdoutLogPath } from './paths.js'

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

  await writeStatus({
    kind: 'kairos',
    state: 'starting',
    pid,
    startedAt,
    updatedAt: startedAt,
  })
  await logLine('startup complete; entering idle loop', {
    stdout: options.stdout,
    now: now(),
    pid,
  })

  const idleAt = now().toISOString()
  await writeStatus({
    kind: 'kairos',
    state: 'idle',
    pid,
    startedAt,
    updatedAt: idleAt,
  })

  await waitForAbort(options.signal)

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

  return 0
}
