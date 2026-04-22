import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type {
  ChildLauncher,
  ChildLauncherParams,
  ChildStreamMessage,
} from './childRunner.js'
import { getKairosGlobalEventsPath, getProjectKairosEventsPath } from './paths.js'
import { createStateWriter } from './stateWriter.js'
import { runTier3Reflection } from './tier3.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  delete process.env.KAIROS_TIER3_INTERVAL_MS
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

function writeTier3Settings(
  projectDir: string,
  settings: { enabled: boolean; intervalMs?: number },
): void {
  const settingsDir = join(projectDir, '.claude')
  mkdirSync(settingsDir, { recursive: true })
  writeFileSync(
    join(settingsDir, 'settings.local.json'),
    JSON.stringify({ kairos: { tier3: settings } }, null, 2),
  )
}

function makeLauncher(messages: ChildStreamMessage[]): {
  launcher: ChildLauncher
  calls: ChildLauncherParams[]
} {
  const calls: ChildLauncherParams[] = []
  const launcher: ChildLauncher = async function* (params) {
    calls.push(params)
    for (const message of messages) {
      yield message
    }
  }
  return { launcher, calls }
}

function makeAssistantJsonMessage(json: string): ChildStreamMessage {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: json }],
    },
  }
}

describe('Kairos Tier 3 reflection', () => {
  test('is disabled by default', async () => {
    const configDir = makeTempDir('kairos-tier3-config-')
    const projectDir = makeTempDir('kairos-tier3-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const stateWriter = await createStateWriter()
    await stateWriter.ensureProjectDir(projectDir)

    const { launcher, calls } = makeLauncher([
      makeAssistantJsonMessage('{"surface":false}'),
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 1,
        duration_ms: 50,
        total_cost_usd: 0.01,
      },
    ])

    const result = await runTier3Reflection({
      projectDir,
      stateWriter,
      launcher,
      costTracker: null,
      defaultAllowedTools: ['Read'],
      maxTurns: 3,
      timeoutMs: 5_000,
      handleCapHit: async () => {},
      now: () => new Date('2026-04-22T12:00:00.000Z'),
    })

    expect(result.outcome).toBe('disabled')
    expect(calls).toHaveLength(0)
    expect(existsSync(join(projectDir, '.claude', 'kairos', 'log.jsonl'))).toBe(
      false,
    )
  })

  test('runs at most once per interval window per project', async () => {
    const configDir = makeTempDir('kairos-tier3-cap-config-')
    const projectDir = makeTempDir('kairos-tier3-cap-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    writeTier3Settings(projectDir, { enabled: true, intervalMs: 60 * 60 * 1000 })

    const stateWriter = await createStateWriter()
    await stateWriter.ensureProjectDir(projectDir)

    const { launcher, calls } = makeLauncher([
      makeAssistantJsonMessage('{"surface":false}'),
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 1,
        duration_ms: 80,
        total_cost_usd: 0.01,
      },
    ])

    const now = () => new Date('2026-04-22T12:15:00.000Z')
    const first = await runTier3Reflection({
      projectDir,
      stateWriter,
      launcher,
      costTracker: null,
      defaultAllowedTools: ['Read'],
      maxTurns: 3,
      timeoutMs: 5_000,
      handleCapHit: async () => {},
      now,
    })
    const second = await runTier3Reflection({
      projectDir,
      stateWriter,
      launcher,
      costTracker: null,
      defaultAllowedTools: ['Read'],
      maxTurns: 3,
      timeoutMs: 5_000,
      handleCapHit: async () => {},
      now,
    })

    expect(first.outcome).toBe('noop')
    expect(second.outcome).toBe('skipped_hourly_cap')
    expect(calls).toHaveLength(1)

    const log = readFileSync(
      join(projectDir, '.claude', 'kairos', 'log.jsonl'),
      'utf8',
    )
    expect(log).toContain('"outcome":"noop"')
    expect(log).toContain('"outcome":"skipped_hourly_cap"')
  })

  test('surface=false logs a no-op without surfacing a message event', async () => {
    const configDir = makeTempDir('kairos-tier3-noop-config-')
    const projectDir = makeTempDir('kairos-tier3-noop-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    writeTier3Settings(projectDir, { enabled: true, intervalMs: 60 * 60 * 1000 })

    const stateWriter = await createStateWriter()
    await stateWriter.ensureProjectDir(projectDir)

    const { launcher } = makeLauncher([
      makeAssistantJsonMessage('{"surface":false}'),
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 1,
        duration_ms: 90,
        total_cost_usd: 0.01,
      },
    ])

    const result = await runTier3Reflection({
      projectDir,
      stateWriter,
      launcher,
      costTracker: null,
      defaultAllowedTools: ['Read'],
      maxTurns: 3,
      timeoutMs: 5_000,
      handleCapHit: async () => {},
      now: () => new Date('2026-04-22T13:00:00.000Z'),
    })

    expect(result.outcome).toBe('noop')

    const projectEvents = readFileSync(
      getProjectKairosEventsPath(projectDir),
      'utf8',
    )
    expect(projectEvents).not.toContain('"kind":"tier3_surface"')

    const log = readFileSync(
      join(projectDir, '.claude', 'kairos', 'log.jsonl'),
      'utf8',
    )
    expect(log).toContain('"outcome":"noop"')
  })

  test('surface=true writes visible message events and filters unsafe tools', async () => {
    const configDir = makeTempDir('kairos-tier3-surface-config-')
    const projectDir = makeTempDir('kairos-tier3-surface-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    writeTier3Settings(projectDir, { enabled: true, intervalMs: 60 * 60 * 1000 })

    const stateWriter = await createStateWriter()
    await stateWriter.ensureProjectDir(projectDir)

    const { launcher, calls } = makeLauncher([
      makeAssistantJsonMessage(
        '{"surface":true,"message":"Tests are failing in auth.ts and should be surfaced before the next run."}',
      ),
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 2,
        duration_ms: 120,
        total_cost_usd: 0.02,
        session_id: 'tier3-session',
      },
    ])

    const result = await runTier3Reflection({
      projectDir,
      stateWriter,
      launcher,
      costTracker: null,
      defaultAllowedTools: ['Read', 'Bash'],
      maxTurns: 3,
      timeoutMs: 5_000,
      handleCapHit: async () => {},
      now: () => new Date('2026-04-22T14:00:00.000Z'),
    })

    expect(result.outcome).toBe('surface')
    expect(result.message).toContain('Tests are failing')
    expect(calls[0]?.allowedTools).toEqual(['Read'])

    const projectEvents = readFileSync(
      getProjectKairosEventsPath(projectDir),
      'utf8',
    )
    expect(projectEvents).toContain('"kind":"tier3_surface"')
    expect(projectEvents).toContain('Tests are failing in auth.ts')

    const globalEvents = readFileSync(getKairosGlobalEventsPath(), 'utf8')
    expect(globalEvents).toContain('"kind":"tier3_surface"')
    expect(globalEvents).toContain(projectDir)

    const log = readFileSync(
      join(projectDir, '.claude', 'kairos', 'log.jsonl'),
      'utf8',
    )
    expect(log).toContain('"outcome":"surface"')
  })
})
