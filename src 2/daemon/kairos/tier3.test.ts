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
import { runTier3Reflection, parseTier3Decision } from './tier3.js'
import {
  getSessionSettingsCache,
  resetSettingsCache,
  setSessionSettingsCache,
} from '../../utils/settings/settingsCache.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  delete process.env.KAIROS_TIER3_INTERVAL_MS
  resetSettingsCache()
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
  settings: { enabled: boolean },
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
  test('parses JSON wrapped in conversational text and markdown fences', () => {
    expect(
      parseTier3Decision(
        'Sure, here is the decision:\n```json\n{"surface":false}\n```\nNo further action.',
      ),
    ).toEqual({ surface: false })

    expect(
      parseTier3Decision(
        'Based on the latest context, use this:\n{"surface":true,"message":"Surface the failing auth tests."}\nThanks.',
      ),
    ).toEqual({
      surface: true,
      message: 'Surface the failing auth tests.',
    })
  })

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

    writeTier3Settings(projectDir, { enabled: true })

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

    writeTier3Settings(projectDir, { enabled: true })

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

  test('skips the run when no safe Tier 3 tools remain after filtering and still consumes the window', async () => {
    const configDir = makeTempDir('kairos-tier3-no-tools-config-')
    const projectDir = makeTempDir('kairos-tier3-no-tools-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    writeTier3Settings(projectDir, { enabled: true })

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

    const now = () => new Date('2026-04-22T13:30:00.000Z')
    const first = await runTier3Reflection({
      projectDir,
      stateWriter,
      launcher,
      costTracker: null,
      defaultAllowedTools: ['Bash'],
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

    expect(first.outcome).toBe('skipped_no_allowed_tools')
    expect(second.outcome).toBe('skipped_hourly_cap')
    expect(calls).toHaveLength(0)

    const log = readFileSync(
      join(projectDir, '.claude', 'kairos', 'log.jsonl'),
      'utf8',
    )
    expect(log).toContain('"outcome":"skipped_no_allowed_tools"')
    expect(log).toContain('"outcome":"skipped_hourly_cap"')
  })

  test('surface=true writes visible message events and filters unsafe tools', async () => {
    const configDir = makeTempDir('kairos-tier3-surface-config-')
    const projectDir = makeTempDir('kairos-tier3-surface-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    writeTier3Settings(projectDir, { enabled: true })

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
    const surfaced: Array<{ projectDir: string; runId: string; message: string }> =
      []

    const result = await runTier3Reflection({
      projectDir,
      stateWriter,
      launcher,
      costTracker: null,
      defaultAllowedTools: ['Read', 'Bash'],
      maxTurns: 3,
      timeoutMs: 5_000,
      handleCapHit: async () => {},
      onSurface: async params => {
        surfaced.push(params)
      },
      now: () => new Date('2026-04-22T14:00:00.000Z'),
    })

    expect(result.outcome).toBe('surface')
    expect(result.message).toContain('Tests are failing')
    expect(calls[0]?.allowedTools).toEqual(['Read'])
    expect(surfaced).toHaveLength(1)
    expect(surfaced[0]?.projectDir).toBe(projectDir)
    expect(surfaced[0]?.message).toContain('Tests are failing')

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

  test('re-reads tier3 settings without clearing the global settings cache', async () => {
    const configDir = makeTempDir('kairos-tier3-reread-config-')
    const projectDir = makeTempDir('kairos-tier3-reread-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const stateWriter = await createStateWriter()
    await stateWriter.ensureProjectDir(projectDir)

    const cachedSettings = { settings: {}, errors: [] }
    setSessionSettingsCache(cachedSettings)

    const disabledLauncher = makeLauncher([
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

    const disabled = await runTier3Reflection({
      projectDir,
      stateWriter,
      launcher: disabledLauncher.launcher,
      costTracker: null,
      defaultAllowedTools: ['Read'],
      maxTurns: 3,
      timeoutMs: 5_000,
      handleCapHit: async () => {},
      now: () => new Date('2026-04-22T14:30:00.000Z'),
    })

    expect(disabled.outcome).toBe('disabled')
    expect(disabledLauncher.calls).toHaveLength(0)
    expect(getSessionSettingsCache()).toBe(cachedSettings)

    writeTier3Settings(projectDir, { enabled: true })

    const enabledLauncher = makeLauncher([
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

    const enabled = await runTier3Reflection({
      projectDir,
      stateWriter,
      launcher: enabledLauncher.launcher,
      costTracker: null,
      defaultAllowedTools: ['Read'],
      maxTurns: 3,
      timeoutMs: 5_000,
      handleCapHit: async () => {},
      now: () => new Date('2026-04-22T15:30:00.000Z'),
    })

    expect(enabled.outcome).toBe('noop')
    expect(enabledLauncher.calls).toHaveLength(1)
    expect(getSessionSettingsCache()).toBe(cachedSettings)
  })

  test('concurrent same-window runs claim the interval only once', async () => {
    const configDir = makeTempDir('kairos-tier3-concurrent-config-')
    const projectDir = makeTempDir('kairos-tier3-concurrent-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    writeTier3Settings(projectDir, { enabled: true })

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

    const now = () => new Date('2026-04-22T14:15:00.000Z')
    const [first, second] = await Promise.all([
      runTier3Reflection({
        projectDir,
        stateWriter,
        launcher,
        costTracker: null,
        defaultAllowedTools: ['Read'],
        maxTurns: 3,
        timeoutMs: 5_000,
        handleCapHit: async () => {},
        now,
      }),
      runTier3Reflection({
        projectDir,
        stateWriter,
        launcher,
        costTracker: null,
        defaultAllowedTools: ['Read'],
        maxTurns: 3,
        timeoutMs: 5_000,
        handleCapHit: async () => {},
        now,
      }),
    ])

    expect([first.outcome, second.outcome].sort()).toEqual([
      'noop',
      'skipped_hourly_cap',
    ])
    expect(calls).toHaveLength(1)
  })

  test('settings interval does not lower the hourly cap, but env override can', async () => {
    const configDir = makeTempDir('kairos-tier3-interval-config-')
    const projectDir = makeTempDir('kairos-tier3-interval-project-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const settingsDir = join(projectDir, '.claude')
    mkdirSync(settingsDir, { recursive: true })
    writeFileSync(
      join(settingsDir, 'settings.local.json'),
      JSON.stringify(
        { kairos: { tier3: { enabled: true, intervalMs: 15_000 } } },
        null,
        2,
      ),
    )

    const stateWriter = await createStateWriter()
    await stateWriter.ensureProjectDir(projectDir)

    const firstLauncher = makeLauncher([
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

    const sameHour = () => new Date('2026-04-22T12:15:00.000Z')
    const first = await runTier3Reflection({
      projectDir,
      stateWriter,
      launcher: firstLauncher.launcher,
      costTracker: null,
      defaultAllowedTools: ['Read'],
      maxTurns: 3,
      timeoutMs: 5_000,
      handleCapHit: async () => {},
      now: sameHour,
    })
    const second = await runTier3Reflection({
      projectDir,
      stateWriter,
      launcher: firstLauncher.launcher,
      costTracker: null,
      defaultAllowedTools: ['Read'],
      maxTurns: 3,
      timeoutMs: 5_000,
      handleCapHit: async () => {},
      now: sameHour,
    })

    expect(first.outcome).toBe('noop')
    expect(second.outcome).toBe('skipped_hourly_cap')
    expect(firstLauncher.calls).toHaveLength(1)

    process.env.KAIROS_TIER3_INTERVAL_MS = '15000'
    const envOverrideLauncher = makeLauncher([
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

    const third = await runTier3Reflection({
      projectDir,
      stateWriter,
      launcher: envOverrideLauncher.launcher,
      costTracker: null,
      defaultAllowedTools: ['Read'],
      maxTurns: 3,
      timeoutMs: 5_000,
      handleCapHit: async () => {},
      now: () => new Date('2026-04-22T12:15:15.000Z'),
    })

    expect(third.outcome).toBe('noop')
    expect(envOverrideLauncher.calls).toHaveLength(1)
  })
})
