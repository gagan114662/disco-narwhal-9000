import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getProjectRoot,
  setProjectRoot,
} from '../../bootstrap/state.js'
import { SKILL_LEARNING_MARKER } from '../../services/skillLearning/distillationPrompt.js'
import { getSkillsUsedPath } from '../../services/skillLearning/skillUseObserver.js'
import { createStateWriter } from './stateWriter.js'
import type { ChildLauncher, ChildStreamMessage } from './childRunner.js'
import { makeCapHitHandler, makeRunFiredTask } from './worker.js'
import type { CronTask } from '../../utils/cronTasks.js'

const TEMP_DIRS: string[] = []
const ORIGINAL_CCD = process.env.CLAUDE_CONFIG_DIR
const ORIGINAL_ROOT = getProjectRoot()

afterEach(() => {
  for (const d of TEMP_DIRS.splice(0)) rmSync(d, { recursive: true, force: true })
  if (ORIGINAL_CCD === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CCD
  setProjectRoot(ORIGINAL_ROOT)
})

function setupEnv(enabled: boolean): {
  projectDir: string
  configDir: string
} {
  const configDir = mkdtempSync(join(tmpdir(), 'kairos-sl-int-cfg-'))
  TEMP_DIRS.push(configDir)
  process.env.CLAUDE_CONFIG_DIR = configDir
  mkdirSync(join(configDir, 'skills'), { recursive: true })

  const projectDir = mkdtempSync(join(tmpdir(), 'kairos-sl-int-proj-'))
  TEMP_DIRS.push(projectDir)
  mkdirSync(join(projectDir, '.claude'), { recursive: true })
  writeFileSync(
    join(projectDir, '.claude', 'settings.json'),
    JSON.stringify({ kairos: { skillLearning: { enabled } } }),
  )
  setProjectRoot(projectDir)
  return { projectDir, configDir }
}

function skillInvokingLauncher(): ChildLauncher {
  const messages: ChildStreamMessage[] = [
    {
      type: 'assistant',
      session_id: 's',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Skill',
            input: { skill: 'investigate' },
          },
        ],
      },
    },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 1,
      duration_ms: 100,
      total_cost_usd: 0,
    },
  ]
  return async function* () {
    for (const m of messages) yield m
  }
}

function makeTask(overrides: Partial<CronTask> = {}): CronTask {
  return {
    id: overrides.id ?? 't-1',
    cron: '* * * * *',
    prompt: overrides.prompt ?? 'do the thing',
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('skill-learning integration via makeRunFiredTask', () => {
  test('successful skill-invoking run writes marker and enqueues distillation', async () => {
    const { projectDir } = setupEnv(true)
    const stateWriter = await createStateWriter()
    await stateWriter.ensureProjectDir(projectDir)
    const now = () => new Date('2026-04-22T12:00:00.000Z')

    const runFiredTask = makeRunFiredTask({
      projectDir,
      stateWriter,
      costTracker: null,
      launcher: skillInvokingLauncher(),
      defaultAllowedTools: ['Read', 'Skill'],
      maxTurns: 1,
      timeoutMs: 5000,
      handleCapHit: makeCapHitHandler(stateWriter, now),
      now,
    })

    const outcome = await runFiredTask(makeTask(), 'event')
    expect(outcome.ok).toBe(true)
    const runId = outcome.result?.runId
    expect(runId).toBeDefined()
    expect(existsSync(getSkillsUsedPath(projectDir, runId!))).toBe(true)

    const scheduled = JSON.parse(
      readFileSync(join(projectDir, '.claude', 'scheduled_tasks.json'), 'utf-8'),
    )
    expect(scheduled.tasks).toHaveLength(1)
    expect(scheduled.tasks[0].prompt.startsWith(SKILL_LEARNING_MARKER)).toBe(
      true,
    )
  })

  test('distillation tasks do not re-trigger skill-learning', async () => {
    const { projectDir } = setupEnv(true)
    const stateWriter = await createStateWriter()
    await stateWriter.ensureProjectDir(projectDir)
    const now = () => new Date('2026-04-22T12:00:00.000Z')

    const runFiredTask = makeRunFiredTask({
      projectDir,
      stateWriter,
      costTracker: null,
      launcher: skillInvokingLauncher(),
      defaultAllowedTools: ['Read', 'Skill'],
      maxTurns: 1,
      timeoutMs: 5000,
      handleCapHit: makeCapHitHandler(stateWriter, now),
      now,
    })

    const outcome = await runFiredTask(
      makeTask({ prompt: `${SKILL_LEARNING_MARKER} distill me` }),
      'event',
    )
    expect(outcome.ok).toBe(true)
    // No scheduled file written.
    expect(
      existsSync(join(projectDir, '.claude', 'scheduled_tasks.json')),
    ).toBe(false)
  })

  test('feature-flag off: no marker, no scheduled task', async () => {
    const { projectDir } = setupEnv(false)
    const stateWriter = await createStateWriter()
    await stateWriter.ensureProjectDir(projectDir)
    const now = () => new Date('2026-04-22T12:00:00.000Z')

    const runFiredTask = makeRunFiredTask({
      projectDir,
      stateWriter,
      costTracker: null,
      launcher: skillInvokingLauncher(),
      defaultAllowedTools: ['Read', 'Skill'],
      maxTurns: 1,
      timeoutMs: 5000,
      handleCapHit: makeCapHitHandler(stateWriter, now),
      now,
    })

    const outcome = await runFiredTask(makeTask(), 'event')
    expect(outcome.ok).toBe(true)
    // Observer still writes the marker (observation is cheap, gating is in
    // the enqueue step) — but no cron task should be scheduled.
    expect(
      existsSync(join(projectDir, '.claude', 'scheduled_tasks.json')),
    ).toBe(false)
  })
})
