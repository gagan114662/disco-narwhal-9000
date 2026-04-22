import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
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
import { enqueueSkillDistillation } from './enqueueSkillDistillation.js'
import { SKILL_LEARNING_MARKER } from './distillationPrompt.js'
import type { SkillsUsedMarker } from './skillUseObserver.js'

const TEMP_DIRS: string[] = []
const ORIGINAL_CCD = process.env.CLAUDE_CONFIG_DIR
const ORIGINAL_ROOT = getProjectRoot()

afterEach(() => {
  for (const d of TEMP_DIRS.splice(0)) rmSync(d, { recursive: true, force: true })
  if (ORIGINAL_CCD === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CCD
  setProjectRoot(ORIGINAL_ROOT)
})

function setup(options: { enabled: boolean } = { enabled: true }): {
  projectDir: string
  configDir: string
} {
  const configDir = mkdtempSync(join(tmpdir(), 'kairos-sl-enq-cfg-'))
  TEMP_DIRS.push(configDir)
  process.env.CLAUDE_CONFIG_DIR = configDir
  mkdirSync(join(configDir, 'skills'), { recursive: true })

  const projectDir = mkdtempSync(join(tmpdir(), 'kairos-sl-enq-proj-'))
  TEMP_DIRS.push(projectDir)
  mkdirSync(join(projectDir, '.claude'), { recursive: true })
  writeFileSync(
    join(projectDir, '.claude', 'settings.json'),
    JSON.stringify({
      kairos: { skillLearning: { enabled: options.enabled } },
    }),
  )
  setProjectRoot(projectDir)
  return { projectDir, configDir }
}

function marker(skills: string[]): SkillsUsedMarker {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    skills: skills.map(name => ({
      name,
      firstAt: '2026-04-22T12:00:00.000Z',
      count: 1,
    })),
  }
}

describe('enqueueSkillDistillation', () => {
  test('returns disabled when feature flag is off', async () => {
    const { projectDir } = setup({ enabled: false })
    const res = await enqueueSkillDistillation({
      projectDir,
      runResult: { runId: 'r1', ok: true },
      skillsUsed: marker(['investigate']),
    })
    expect(res.status).toBe('disabled')
  })

  test('returns run_failed when the parent run did not succeed', async () => {
    const { projectDir } = setup()
    const res = await enqueueSkillDistillation({
      projectDir,
      runResult: { runId: 'r1', ok: false },
      skillsUsed: marker(['investigate']),
    })
    expect(res.status).toBe('run_failed')
  })

  test('returns no_skills when the marker is empty', async () => {
    const { projectDir } = setup()
    const res = await enqueueSkillDistillation({
      projectDir,
      runResult: { runId: 'r1', ok: true },
      skillsUsed: marker([]),
    })
    expect(res.status).toBe('no_skills')
  })

  test('happy path: enqueues one cron task per skill with sentinel', async () => {
    const { projectDir } = setup()
    const res = await enqueueSkillDistillation({
      projectDir,
      runResult: { runId: 'r1', ok: true },
      skillsUsed: marker(['investigate', 'debug']),
    })
    expect(res.status).toBe('enqueued')
    const file = join(projectDir, '.claude', 'scheduled_tasks.json')
    const body = JSON.parse(readFileSync(file, 'utf-8'))
    expect(body.tasks).toHaveLength(2)
    for (const t of body.tasks) {
      expect(t.prompt.startsWith(`${SKILL_LEARNING_MARKER} skill=`)).toBe(true)
      expect(t.recurring).toBeUndefined()
    }
  })

  test('does not enqueue a second task for the same skill while one is pending', async () => {
    const { projectDir } = setup()
    await enqueueSkillDistillation({
      projectDir,
      runResult: { runId: 'r1', ok: true },
      skillsUsed: marker(['investigate']),
    })
    const res = await enqueueSkillDistillation({
      projectDir,
      runResult: { runId: 'r2', ok: true },
      skillsUsed: marker(['investigate']),
    })
    expect(res.status).toBe('duplicate')
  })

  test('concurrent calls on the same project+skill enqueue exactly one task', async () => {
    // Regression for the check-then-write race: without the per-project
    // lock, two in-flight enqueues can both pass the pending/rate-limit
    // checks and both call addCronTask, producing two identical tasks.
    const { projectDir } = setup()
    const [a, b] = await Promise.all([
      enqueueSkillDistillation({
        projectDir,
        runResult: { runId: 'rA', ok: true },
        skillsUsed: marker(['investigate']),
      }),
      enqueueSkillDistillation({
        projectDir,
        runResult: { runId: 'rB', ok: true },
        skillsUsed: marker(['investigate']),
      }),
    ])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual(['duplicate', 'enqueued'])
    const body = JSON.parse(
      readFileSync(
        join(projectDir, '.claude', 'scheduled_tasks.json'),
        'utf-8',
      ),
    )
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0].kind).toBe('skill_distillation')
  })
})
