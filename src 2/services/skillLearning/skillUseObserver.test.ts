import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildEvent } from '../../daemon/kairos/childRunner.js'
import {
  createRunSkillUseObserver,
  createSkillUseObserver,
  extractSkillName,
  getSkillsUsedPath,
} from './skillUseObserver.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  for (const d of TEMP_DIRS.splice(0)) rmSync(d, { recursive: true, force: true })
})

function makeProjectDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'kairos-sl-obs-'))
  TEMP_DIRS.push(d)
  return d
}

function toolUsed(
  name: string,
  input: unknown,
  t = '2026-04-22T12:00:00.000Z',
): ChildEvent {
  return {
    kind: 'tool_used',
    t,
    runId: 'r1',
    toolName: name,
    toolInput: input,
  }
}

describe('extractSkillName', () => {
  test('accepts {skill}', () => {
    expect(extractSkillName({ skill: 'investigate' })).toBe('investigate')
  })
  test('accepts {skill_name}', () => {
    expect(extractSkillName({ skill_name: 'debug' })).toBe('debug')
  })
  test('rejects empty and non-string', () => {
    expect(extractSkillName({ skill: '' })).toBeNull()
    expect(extractSkillName({ skill: 42 })).toBeNull()
    expect(extractSkillName(null)).toBeNull()
  })
})

describe('createSkillUseObserver', () => {
  test('records one skill invocation', async () => {
    const obs = createSkillUseObserver('task-1')
    await obs.onEvent(toolUsed('Skill', { skill: 'investigate' }))
    expect(obs.hasSkillUse()).toBe(true)
    expect(obs.getSkills()).toEqual([
      {
        name: 'investigate',
        firstAt: '2026-04-22T12:00:00.000Z',
        count: 1,
      },
    ])
  })

  test('counts multiple invocations of same skill, preserves first-seen order', async () => {
    const obs = createSkillUseObserver('task-2')
    await obs.onEvent(toolUsed('Skill', { skill: 'alpha' }, '2026-04-22T12:00:00Z'))
    await obs.onEvent(toolUsed('Skill', { skill: 'beta' }, '2026-04-22T12:00:05Z'))
    await obs.onEvent(toolUsed('Skill', { skill: 'alpha' }, '2026-04-22T12:00:10Z'))
    const skills = obs.getSkills()
    expect(skills).toHaveLength(2)
    expect(skills[0]).toMatchObject({ name: 'alpha', count: 2 })
    expect(skills[1]).toMatchObject({ name: 'beta', count: 1 })
  })

  test('ignores tool_used with toolName !== Skill', async () => {
    const obs = createSkillUseObserver('task-3')
    await obs.onEvent(toolUsed('Read', { file_path: '/x' }))
    expect(obs.hasSkillUse()).toBe(false)
  })

  test('ignores Skill tool_use without a valid skill name', async () => {
    const obs = createSkillUseObserver('task-4')
    await obs.onEvent(toolUsed('Skill', {}))
    await obs.onEvent(toolUsed('Skill', { skill: 42 }))
    expect(obs.hasSkillUse()).toBe(false)
  })

  test('chains to a provided onEvent', async () => {
    const seen: ChildEvent[] = []
    const obs = createSkillUseObserver('task-5', {
      onEvent: e => {
        seen.push(e)
      },
    })
    const ev = toolUsed('Skill', { skill: 'x' })
    await obs.onEvent(ev)
    expect(seen).toEqual([ev])
  })
})

describe('createRunSkillUseObserver.finalize', () => {
  test('returns null and writes nothing when no skill invoked', async () => {
    const projectDir = makeProjectDir()
    const obs = createRunSkillUseObserver('task-none', 'run-none')
    await obs.onEvent(toolUsed('Read', { file_path: '/x' }))
    const path = await obs.finalize(projectDir)
    expect(path).toBeNull()
    expect(existsSync(getSkillsUsedPath(projectDir, 'run-none'))).toBe(false)
  })

  test('writes marker file with recorded skills', async () => {
    const projectDir = makeProjectDir()
    const obs = createRunSkillUseObserver('task-7', 'run-7')
    await obs.onEvent(toolUsed('Skill', { skill: 'investigate' }))
    await obs.onEvent(toolUsed('Skill', { skill: 'debug' }))
    const path = await obs.finalize(projectDir)
    expect(path).not.toBeNull()
    expect(existsSync(path!)).toBe(true)
    const body = JSON.parse(readFileSync(path!, 'utf-8'))
    expect(body.runId).toBe('run-7')
    expect(body.taskId).toBe('task-7')
    expect(body.skills).toHaveLength(2)
    expect(body.skills[0].name).toBe('investigate')
  })
})
