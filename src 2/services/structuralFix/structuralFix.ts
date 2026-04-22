import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getProjectRoot } from '../../bootstrap/state.js'
import {
  getCronFilePath,
  readCronTasks,
  type CronTask,
  writeCronTasks,
} from '../../utils/cronTasks.js'
import { safeParseJSON } from '../../utils/json.js'

export const STRUCTURAL_FIX_SKILL_NAME = 'permanent-structural-fix'
export const STRUCTURAL_FIX_DAILY_MARKER =
  '<!-- permanent-structural-fix-daily -->'
export const STRUCTURAL_FIX_DAILY_CRON = '17 9 * * *'

export type StructuralFixResolverRule = {
  id: string
  anyPhrases?: string[]
  allTerms?: string[]
  pattern?: string
}

export type StructuralFixResolver = {
  skill: string
  description: string
  rules: StructuralFixResolverRule[]
}

export type StructuralFixResolverEvalCase = {
  id: string
  input: string
  expectedSkill: string | null
}

export type StructuralFixResolverEvalSuite = {
  skill: string
  cases: StructuralFixResolverEvalCase[]
}

export type StructuralFixLlmEvalCase = {
  id: string
  context: string
  task: string
  requiredArtifacts: string[]
  judgeQuestions: string[]
}

export type StructuralFixLlmEvalSuite = {
  skill: string
  cases: StructuralFixLlmEvalCase[]
}

export type StructuralFixResolution = {
  skill: string
  ruleId: string
}

export type StructuralFixResolverEvaluation = {
  total: number
  passed: number
  failed: Array<{
    id: string
    input: string
    expectedSkill: string | null
    actualSkill: string | null
  }>
}

export type StructuralFixDuplicateAudit = {
  duplicateRuleIds: string[]
  duplicateAnyPhrases: string[]
  duplicateAllTermSets: string[]
  duplicatePatterns: string[]
  duplicateResolverCaseIds: string[]
  duplicateLlmEvalCaseIds: string[]
  duplicateJudgeQuestions: string[]
}

export type EnsureStructuralFixDailyTaskResult = {
  status: 'scheduled' | 'duplicate'
  id: string
  cron: string
  filePath: string
}

export type StructuralFixSmokeReport = {
  skill: string
  resolverEvaluation: StructuralFixResolverEvaluation
  duplicateAudit: StructuralFixDuplicateAudit
  llmEvalCount: number
  dailyTask: EnsureStructuralFixDailyTaskResult
}

type EnsureDailyTaskDeps = {
  now?: Date
  generateId?: () => string
}

function getProjectDir(projectDir?: string): string {
  return projectDir ?? getProjectRoot()
}

function getSkillDir(projectDir?: string): string {
  return join(
    getProjectDir(projectDir),
    '.claude',
    'skills',
    STRUCTURAL_FIX_SKILL_NAME,
  )
}

export function getStructuralFixResolverPath(projectDir?: string): string {
  return join(getSkillDir(projectDir), 'resolver-trigger.json')
}

export function getStructuralFixResolverEvalPath(projectDir?: string): string {
  return join(
    getProjectDir(projectDir),
    'evals',
    STRUCTURAL_FIX_SKILL_NAME,
    'resolver-cases.json',
  )
}

export function getStructuralFixLlmEvalPath(projectDir?: string): string {
  return join(
    getProjectDir(projectDir),
    'evals',
    STRUCTURAL_FIX_SKILL_NAME,
    'llm-evals.json',
  )
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf8')
  const parsed = safeParseJSON(raw, false)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid JSON fixture: ${filePath}`)
  }
  return parsed as T
}

export async function readStructuralFixResolver(
  projectDir?: string,
): Promise<StructuralFixResolver> {
  return readJsonFile<StructuralFixResolver>(
    getStructuralFixResolverPath(projectDir),
  )
}

export async function readStructuralFixResolverEvals(
  projectDir?: string,
): Promise<StructuralFixResolverEvalSuite> {
  return readJsonFile<StructuralFixResolverEvalSuite>(
    getStructuralFixResolverEvalPath(projectDir),
  )
}

export async function readStructuralFixLlmEvals(
  projectDir?: string,
): Promise<StructuralFixLlmEvalSuite> {
  return readJsonFile<StructuralFixLlmEvalSuite>(
    getStructuralFixLlmEvalPath(projectDir),
  )
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

function matchesRule(text: string, rule: StructuralFixResolverRule): boolean {
  if (rule.anyPhrases?.some(phrase => text.includes(normalizeText(phrase)))) {
    return true
  }
  if (rule.allTerms?.every(term => text.includes(normalizeText(term)))) {
    return true
  }
  if (rule.pattern && new RegExp(rule.pattern, 'i').test(text)) {
    return true
  }
  return false
}

export function resolveStructuralFixSkill(
  input: string,
  resolver: StructuralFixResolver,
): StructuralFixResolution | null {
  const text = normalizeText(input)
  for (const rule of resolver.rules) {
    if (matchesRule(text, rule)) {
      return {
        skill: resolver.skill,
        ruleId: rule.id,
      }
    }
  }
  return null
}

export function evaluateStructuralFixResolver(
  resolver: StructuralFixResolver,
  suite: StructuralFixResolverEvalSuite,
): StructuralFixResolverEvaluation {
  const failed: StructuralFixResolverEvaluation['failed'] = []
  for (const testCase of suite.cases) {
    const actual = resolveStructuralFixSkill(testCase.input, resolver)
    const actualSkill = actual?.skill ?? null
    if (actualSkill !== testCase.expectedSkill) {
      failed.push({
        id: testCase.id,
        input: testCase.input,
        expectedSkill: testCase.expectedSkill,
        actualSkill,
      })
    }
  }
  return {
    total: suite.cases.length,
    passed: suite.cases.length - failed.length,
    failed,
  }
}

function findDuplicates(values: string[]): string[] {
  const counts = new Map<string, number>()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort()
}

export function auditStructuralFixDuplicates(
  resolver: StructuralFixResolver,
  resolverSuite: StructuralFixResolverEvalSuite,
  llmSuite: StructuralFixLlmEvalSuite,
): StructuralFixDuplicateAudit {
  return {
    duplicateRuleIds: findDuplicates(resolver.rules.map(rule => rule.id)),
    duplicateAnyPhrases: findDuplicates(
      resolver.rules.flatMap(rule =>
        (rule.anyPhrases ?? []).map(phrase => normalizeText(phrase)),
      ),
    ),
    duplicateAllTermSets: findDuplicates(
      resolver.rules
        .filter(rule => rule.allTerms && rule.allTerms.length > 0)
        .map(rule =>
          [...(rule.allTerms ?? [])]
            .map(term => normalizeText(term))
            .sort()
            .join('||'),
        ),
    ),
    duplicatePatterns: findDuplicates(
      resolver.rules
        .map(rule => rule.pattern)
        .filter((pattern): pattern is string => typeof pattern === 'string')
        .map(pattern => pattern.trim()),
    ),
    duplicateResolverCaseIds: findDuplicates(
      resolverSuite.cases.map(testCase => testCase.id),
    ),
    duplicateLlmEvalCaseIds: findDuplicates(
      llmSuite.cases.map(testCase => testCase.id),
    ),
    duplicateJudgeQuestions: findDuplicates(
      llmSuite.cases.flatMap(testCase =>
        testCase.judgeQuestions.map(question => normalizeText(question)),
      ),
    ),
  }
}

function duplicateAuditProblems(audit: StructuralFixDuplicateAudit): string[] {
  const problems: string[] = []
  if (audit.duplicateRuleIds.length > 0) {
    problems.push(`duplicate rule ids: ${audit.duplicateRuleIds.join(', ')}`)
  }
  if (audit.duplicateAnyPhrases.length > 0) {
    problems.push(
      `duplicate resolver phrases: ${audit.duplicateAnyPhrases.join(', ')}`,
    )
  }
  if (audit.duplicateAllTermSets.length > 0) {
    problems.push(
      `duplicate all-term rule sets: ${audit.duplicateAllTermSets.join(', ')}`,
    )
  }
  if (audit.duplicatePatterns.length > 0) {
    problems.push(
      `duplicate regex patterns: ${audit.duplicatePatterns.join(', ')}`,
    )
  }
  if (audit.duplicateResolverCaseIds.length > 0) {
    problems.push(
      `duplicate resolver eval ids: ${audit.duplicateResolverCaseIds.join(', ')}`,
    )
  }
  if (audit.duplicateLlmEvalCaseIds.length > 0) {
    problems.push(
      `duplicate llm eval ids: ${audit.duplicateLlmEvalCaseIds.join(', ')}`,
    )
  }
  if (audit.duplicateJudgeQuestions.length > 0) {
    problems.push(
      `duplicate llm judge questions: ${audit.duplicateJudgeQuestions.join(', ')}`,
    )
  }
  return problems
}

export function buildStructuralFixDailyPrompt(projectDir?: string): string {
  const root = getProjectDir(projectDir)
  return [
    STRUCTURAL_FIX_DAILY_MARKER,
    `Run /${STRUCTURAL_FIX_SKILL_NAME} for this repository.`,
    `Project root: ${root}`,
    'Audit checklist:',
    '1. Run `bun run structural-fix:daily`.',
    '2. If any check fails, update the skill, deterministic code, tests, evals, or resolver trigger so the same failure class is permanently covered.',
    '3. Keep duplicate audits clean.',
    '4. Summarize any newly structuralized failure modes.',
  ].join('\n')
}

function findExistingDailyTask(tasks: CronTask[]): CronTask | undefined {
  return tasks.find(
    task =>
      task.recurring === true &&
      task.permanent === true &&
      task.prompt.startsWith(STRUCTURAL_FIX_DAILY_MARKER),
  )
}

function defaultGenerateId(): string {
  return randomUUID().slice(0, 8)
}

export async function hasStructuralFixDailyTask(
  projectDir?: string,
): Promise<boolean> {
  const tasks = await readCronTasks(getProjectDir(projectDir))
  return findExistingDailyTask(tasks) !== undefined
}

export async function ensureStructuralFixDailyTask(
  projectDir?: string,
  deps: EnsureDailyTaskDeps = {},
): Promise<EnsureStructuralFixDailyTaskResult> {
  const root = getProjectDir(projectDir)
  const tasks = await readCronTasks(root)
  const existing = findExistingDailyTask(tasks)
  const filePath = getCronFilePath(root)

  if (existing) {
    return {
      status: 'duplicate',
      id: existing.id,
      cron: existing.cron,
      filePath,
    }
  }

  const id = (deps.generateId ?? defaultGenerateId)()
  const createdAt = (deps.now ?? new Date()).getTime()
  const nextTask: CronTask = {
    id,
    cron: STRUCTURAL_FIX_DAILY_CRON,
    prompt: buildStructuralFixDailyPrompt(root),
    createdAt,
    recurring: true,
    permanent: true,
  }
  await writeCronTasks([...tasks, nextTask], root)

  return {
    status: 'scheduled',
    id,
    cron: STRUCTURAL_FIX_DAILY_CRON,
    filePath,
  }
}

export async function runStructuralFixSmoke(
  projectDir?: string,
): Promise<StructuralFixSmokeReport> {
  const root = getProjectDir(projectDir)
  const [resolver, resolverSuite, llmSuite] = await Promise.all([
    readStructuralFixResolver(root),
    readStructuralFixResolverEvals(root),
    readStructuralFixLlmEvals(root),
  ])

  if (
    resolver.skill !== STRUCTURAL_FIX_SKILL_NAME ||
    resolverSuite.skill !== STRUCTURAL_FIX_SKILL_NAME ||
    llmSuite.skill !== STRUCTURAL_FIX_SKILL_NAME
  ) {
    throw new Error('Structural fix fixtures disagree on the skill name')
  }

  const duplicateAudit = auditStructuralFixDuplicates(
    resolver,
    resolverSuite,
    llmSuite,
  )
  const duplicateProblems = duplicateAuditProblems(duplicateAudit)
  if (duplicateProblems.length > 0) {
    throw new Error(
      `Structural fix duplicate audit failed: ${duplicateProblems.join('; ')}`,
    )
  }

  const resolverEvaluation = evaluateStructuralFixResolver(
    resolver,
    resolverSuite,
  )
  if (resolverEvaluation.failed.length > 0) {
    throw new Error(
      `Structural fix resolver eval failed: ${resolverEvaluation.failed
        .map(failure => `${failure.id} -> expected ${failure.expectedSkill ?? 'null'}, got ${failure.actualSkill ?? 'null'}`)
        .join('; ')}`,
    )
  }

  const dailyTask = await ensureStructuralFixDailyTask(root)

  return {
    skill: STRUCTURAL_FIX_SKILL_NAME,
    resolverEvaluation,
    duplicateAudit,
    llmEvalCount: llmSuite.cases.length,
    dailyTask,
  }
}
