import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { CronTask } from '../../utils/cronTasks.js'
import type { ChildLauncher } from './childRunner.js'
import { AUTH_FAILURE_NOTICE } from './childRunner.js'
import type { PauseState } from './stateWriter.js'
import { createStateWriter } from './stateWriter.js'
import {
  createAuthFailurePauseGate,
  makeAuthFailureHandler,
  makeCapHitHandler,
  makeRunFiredTask,
} from './worker.js'
import {
  getKairosGlobalEventsPath,
  getKairosPausePath,
  getProjectKairosEventsPath,
} from './paths.js'

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

function makeTask(id: string): CronTask {
  return { id, cron: '* * * * *', prompt: 'do work', createdAt: Date.now() }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readJsonLines(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

describe('auth-failure integration', () => {
  test('auth error from launcher pauses the daemon globally and writes the re-auth notice', async () => {
    const configDir = makeTempDir('kairos-auth-')
    const projectDir = makeTempDir('kairos-auth-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const stateWriter = await createStateWriter()
    await stateWriter.ensureProjectDir(projectDir)

    let callCount = 0
    // Async generator that throws before yielding — models the SDK's `query()`
    // rejecting on 401. Written as an explicit iterator so lint's
    // require-yield rule sees a reachable yield-shaped contract.
    const launcher: ChildLauncher = () => ({
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<never>> {
            callCount += 1
            throw new Error(
              'Request failed: 401 Unauthorized (Keychain denied)',
            )
          },
        }
      },
    })

    const now = () => new Date('2026-04-22T12:00:00.000Z')
    const handleCapHit = makeCapHitHandler(stateWriter, now)
    const handleAuthFailure = makeAuthFailureHandler(stateWriter, now)

    const runFiredTask = makeRunFiredTask({
      projectDir,
      stateWriter,
      costTracker: null,
      launcher,
      defaultAllowedTools: ['Read'],
      maxTurns: 1,
      timeoutMs: 5_000,
      handleCapHit,
      handleAuthFailure,
      now,
    })

    const outcome1 = await runFiredTask(makeTask('auth-1'), 'event')
    expect(outcome1.ok).toBe(false)
    expect(outcome1.paused).toBe(true)
    expect(outcome1.result?.exitReason).toBe('auth_failure')
    expect(callCount).toBe(1)

    const pause = readJson(getKairosPausePath()) as {
      paused: boolean
      reason?: string
      scope?: string
      source?: string
      notice?: string
    }
    expect(pause.paused).toBe(true)
    expect(pause.reason).toBe('auth_failure')
    expect(pause.scope).toBe('global')
    expect(pause.source).toBe('daemon')
    expect(pause.notice).toBe(AUTH_FAILURE_NOTICE)

    const globalEvents = readJsonLines(getKairosGlobalEventsPath()) as Array<
      Record<string, unknown>
    >
    const authGlobal = globalEvents.find(e => e.kind === 'auth_failure')
    expect(authGlobal).toBeDefined()
    expect(authGlobal).toMatchObject({
      kind: 'auth_failure',
      projectDir,
      taskId: 'auth-1',
      source: 'daemon',
      notice: AUTH_FAILURE_NOTICE,
    })

    const projectEvents = readJsonLines(getProjectKairosEventsPath(projectDir))
    expect(
      (projectEvents as Array<Record<string, unknown>>).some(
        e => e.kind === 'auth_failure',
      ),
    ).toBe(true)
  })
})

describe('createAuthFailurePauseGate', () => {
  // Unit tests for the in-memory latch. Covers the cross-project race
  // where project A's async writePauseState hasn't landed on disk yet
  // when project B's checkPaused runs.
  function makeStubReader(state: PauseState | null) {
    let current = state
    return {
      readPauseState: async () => current,
      set: (next: PauseState | null) => {
        current = next
      },
    }
  }

  test('returns on-disk paused state when latch is not set', async () => {
    const reader = makeStubReader({
      paused: true,
      reason: 'cap_hit',
      scope: 'global',
      source: 'daemon',
    })
    const gate = createAuthFailurePauseGate(reader)
    expect(await gate.isPaused()).toBe(true)
    reader.set({ paused: false, source: 'user' })
    expect(await gate.isPaused()).toBe(false)
  })

  test('latch flips to paused even when on-disk state is still unpaused', async () => {
    // Models the race window: A called handleAuthFailure (which flips the
    // in-memory latch synchronously) but the writePauseState hasn't
    // landed. B's isPaused() must still return true.
    const reader = makeStubReader(null)
    const gate = createAuthFailurePauseGate(reader)
    expect(await gate.isPaused()).toBe(false)

    gate.latch()
    expect(await gate.isPaused()).toBe(true)

    reader.set({ paused: false, source: 'daemon' })
    expect(await gate.isPaused()).toBe(true)
  })

  test('user-authored resume clears the latch; daemon-authored does not', async () => {
    const reader = makeStubReader(null)
    const gate = createAuthFailurePauseGate(reader)
    gate.latch()
    expect(await gate.isPaused()).toBe(true)

    // Daemon-authored unpause (shouldn't happen in practice, defensive).
    reader.set({ paused: false, source: 'daemon' })
    expect(await gate.isPaused()).toBe(true)

    // User runs /kairos resume → pause.json has {paused:false, source:'user'}.
    reader.set({ paused: false, source: 'user' })
    expect(await gate.isPaused()).toBe(false)
  })
})
