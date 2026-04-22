import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getProjectRoot,
  setProjectRoot,
} from '../../bootstrap/state.js'
import { readCronTasks } from '../../utils/cronTasks.js'
import {
  STRUCTURAL_FIX_DAILY_CRON,
  STRUCTURAL_FIX_DAILY_MARKER,
  auditStructuralFixDuplicates,
  ensureStructuralFixDailyTask,
  evaluateStructuralFixResolver,
  readStructuralFixLlmEvals,
  readStructuralFixResolver,
  readStructuralFixResolverEvals,
  resolveStructuralFixSkill,
  runStructuralFixSmoke,
} from './structuralFix.js'

const TEMP_DIRS: string[] = []
let originalProjectRoot: string
const REPO_ROOT = join(process.cwd(), '..')

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'structural-fix-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

beforeEach(() => {
  originalProjectRoot = getProjectRoot()
})

afterEach(() => {
  setProjectRoot(originalProjectRoot)
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('structural fix resolver fixtures', () => {
  test('checked-in resolver cases all pass', async () => {
    const [resolver, suite] = await Promise.all([
      readStructuralFixResolver(REPO_ROOT),
      readStructuralFixResolverEvals(REPO_ROOT),
    ])

    const evaluation = evaluateStructuralFixResolver(resolver, suite)

    expect(evaluation.failed).toEqual([])
    expect(evaluation.passed).toBe(evaluation.total)
  })

  test('resolves a permanent fix request and ignores a plain feature request', async () => {
    const resolver = await readStructuralFixResolver(REPO_ROOT)

    expect(
      resolveStructuralFixSkill(
        'Write a skill, deterministic code, unit tests, LLM evals, and a resolver trigger for this failure.',
        resolver,
      ),
    ).toMatchObject({
      skill: 'permanent-structural-fix',
    })

    expect(
      resolveStructuralFixSkill(
        'Add a new remind command that schedules a one-shot cron task.',
        resolver,
      ),
    ).toBeNull()
  })

  test('checked-in fixtures have no duplicate ids or phrases', async () => {
    const [resolver, resolverSuite, llmSuite] = await Promise.all([
      readStructuralFixResolver(REPO_ROOT),
      readStructuralFixResolverEvals(REPO_ROOT),
      readStructuralFixLlmEvals(REPO_ROOT),
    ])

    const audit = auditStructuralFixDuplicates(resolver, resolverSuite, llmSuite)

    expect(audit).toEqual({
      duplicateRuleIds: [],
      duplicateAnyPhrases: [],
      duplicateAllTermSets: [],
      duplicatePatterns: [],
      duplicateResolverCaseIds: [],
      duplicateLlmEvalCaseIds: [],
      duplicateJudgeQuestions: [],
    })
  })
})

describe('structural fix daily schedule', () => {
  test('ensureStructuralFixDailyTask writes exactly one permanent recurring cron', async () => {
    const projectDir = makeProjectDir()
    setProjectRoot(projectDir)

    const first = await ensureStructuralFixDailyTask(projectDir, {
      now: new Date('2026-04-22T09:17:00.000Z'),
      generateId: () => 'fixloop1',
    })
    const second = await ensureStructuralFixDailyTask(projectDir, {
      now: new Date('2026-04-22T09:17:00.000Z'),
      generateId: () => 'fixloop2',
    })

    expect(first.status).toBe('scheduled')
    expect(second.status).toBe('duplicate')
    expect(second.id).toBe('fixloop1')
    expect(second.cron).toBe(STRUCTURAL_FIX_DAILY_CRON)

    const tasks = await readCronTasks(projectDir)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: 'fixloop1',
      cron: STRUCTURAL_FIX_DAILY_CRON,
      recurring: true,
      permanent: true,
    })
    expect(tasks[0]!.prompt.startsWith(STRUCTURAL_FIX_DAILY_MARKER)).toBe(true)
  })

  test('smoke run passes checked-in fixtures and installs the daily task', async () => {
    const report = await runStructuralFixSmoke(REPO_ROOT)

    expect(report.skill).toBe('permanent-structural-fix')
    expect(report.resolverEvaluation.failed).toEqual([])
    expect(report.llmEvalCount).toBeGreaterThan(0)
    expect(['scheduled', 'duplicate']).toContain(report.dailyTask.status)

    const raw = readFileSync(
      join(REPO_ROOT, '.claude', 'scheduled_tasks.json'),
      'utf8',
    )
    expect(raw).toContain(STRUCTURAL_FIX_DAILY_MARKER)
  })
})
