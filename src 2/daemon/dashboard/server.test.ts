import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeCronTasks } from '../../utils/cronTasks.js'
import { createProjectRegistry } from '../kairos/projectRegistry.js'
import { getKairosPausePath } from '../kairos/paths.js'
import { createStateWriter } from '../kairos/stateWriter.js'
import { startKairosDashboardServer } from './server.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(50)
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`)
}

async function seedState(projectDir: string): Promise<void> {
  const registry = await createProjectRegistry()
  await registry.write([projectDir])

  const stateWriter = await createStateWriter()
  await stateWriter.ensureProjectDir(projectDir)
  await stateWriter.writeGlobalStatus({
    kind: 'kairos',
    state: 'idle',
    pid: 42,
    startedAt: '2026-04-22T12:00:00.000Z',
    updatedAt: '2026-04-22T12:00:00.000Z',
    projects: 1,
    lastEventAt: '2026-04-22T12:00:00.000Z',
  })
  await stateWriter.writeProjectStatus({
    projectDir,
    running: false,
    dirty: false,
    pendingCount: 0,
    lastEvent: 'worker_started',
    updatedAt: '2026-04-22T12:00:00.000Z',
    nextFireAt: null,
  })
  await stateWriter.writeGlobalCosts({
    totalUSD: 0.25,
    totalTurns: 3,
    runs: 2,
    updatedAt: '2026-04-22T12:00:00.000Z',
  })
  await stateWriter.writeProjectCosts(projectDir, {
    totalUSD: 0.15,
    totalTurns: 2,
    runs: 1,
    updatedAt: '2026-04-22T12:00:00.000Z',
  })
  await stateWriter.appendGlobalEvent({
    kind: 'project_registered',
    t: '2026-04-22T12:00:00.000Z',
    projectDir,
  })
  await stateWriter.appendProjectLog(projectDir, {
    kind: 'worker_started',
    t: '2026-04-22T12:00:00.000Z',
  })
  await stateWriter.appendProjectEvent(projectDir, {
    kind: 'child_finished',
    t: '2026-04-22T12:00:01.000Z',
    source: 'event',
    taskId: 'abc12345',
  })
  await writeCronTasks(
    [
      {
        id: 'demo1234',
        cron: '5 12 22 4 *',
        prompt: 'demo task',
        createdAt: Date.now(),
      },
    ],
    projectDir,
  )
}

async function readSseUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
  timeoutMs = 6_000,
): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      Bun.sleep(250).then(() => null),
    ])
    if (!chunk) continue
    if (chunk.done) break
    text += decoder.decode(chunk.value, { stream: true })
    if (text.includes(needle)) return text
  }
  throw new Error(`Timed out waiting for SSE payload containing ${needle}`)
}

describe('KAIROS dashboard server', () => {
  test('serves snapshot and control endpoints', async () => {
    const configDir = makeTempDir('kairos-dashboard-config-')
    const projectDir = makeTempDir('kairos-dashboard-project-')
    const projectDir2 = makeTempDir('kairos-dashboard-project-extra-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    await seedState(projectDir)

    const server = await startKairosDashboardServer({ port: 0 })

    try {
      const stateResponse = await fetch(`${server.url}/api/state`)
      const snapshot = await stateResponse.json()
      expect(snapshot.global.status.state).toBe('idle')
      expect(snapshot.global.projects).toEqual([projectDir])
      expect(snapshot.projects).toHaveLength(1)
      expect(snapshot.projects[0].tasks[0].id).toBe('demo1234')

      const pauseResponse = await fetch(`${server.url}/api/pause`, {
        method: 'POST',
      })
      expect(pauseResponse.ok).toBe(true)
      const paused = JSON.parse(readFileSync(getKairosPausePath(), 'utf8'))
      expect(paused).toMatchObject({ paused: true, source: 'user' })

      const resumeResponse = await fetch(`${server.url}/api/resume`, {
        method: 'POST',
      })
      expect(resumeResponse.ok).toBe(true)
      const resumed = JSON.parse(readFileSync(getKairosPausePath(), 'utf8'))
      expect(resumed).toMatchObject({ paused: false, source: 'user' })

      const optInResponse = await fetch(`${server.url}/api/projects/opt-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectDir: projectDir2 }),
      })
      expect(optInResponse.ok).toBe(true)
      const registry = await createProjectRegistry()
      expect(await registry.read()).toEqual(
        [projectDir, projectDir2].sort(),
      )

      const demoResponse = await fetch(`${server.url}/api/projects/demo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectDir }),
      })
      const demoBody = await demoResponse.json()
      expect(demoResponse.ok).toBe(true)
      expect(demoBody.taskId).toHaveLength(8)

      const tasksFile = JSON.parse(
        readFileSync(join(projectDir, '.claude', 'scheduled_tasks.json'), 'utf8'),
      )
      expect(tasksFile.tasks).toHaveLength(2)

      const optOutResponse = await fetch(`${server.url}/api/projects/opt-out`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectDir: projectDir2 }),
      })
      expect(optOutResponse.ok).toBe(true)
      expect(await registry.read()).toEqual([projectDir])
    } finally {
      await server.stop()
    }
  })

  test(
    'rebroadcasts snapshots over SSE when control actions change state',
    { timeout: 10_000 },
    async () => {
      const configDir = makeTempDir('kairos-dashboard-sse-config-')
      const projectDir = makeTempDir('kairos-dashboard-sse-project-')
      process.env.CLAUDE_CONFIG_DIR = configDir
      await seedState(projectDir)

      const server = await startKairosDashboardServer({ port: 0 })
      const controller = new AbortController()

      try {
        const response = await fetch(`${server.url}/api/events`, {
          signal: controller.signal,
        })
        expect(response.ok).toBe(true)
        const reader = response.body?.getReader()
        expect(reader).toBeDefined()
        if (!reader) throw new Error('Missing SSE reader')

        await readSseUntil(reader, '"state":"idle"')

        const pauseResponse = await fetch(`${server.url}/api/pause`, {
          method: 'POST',
        })
        expect(pauseResponse.ok).toBe(true)
        await waitFor(() =>
          readFileSync(getKairosPausePath(), 'utf8').includes('"paused": true'),
        )

        const ssePayload = await readSseUntil(reader, '"paused":true')
        expect(ssePayload).toContain('"paused":true')
        expect(readFileSync(getKairosPausePath(), 'utf8')).toContain(
          '"paused": true',
        )

        controller.abort()
        await reader.cancel()
      } finally {
        await server.stop()
      }
    },
  )
})
