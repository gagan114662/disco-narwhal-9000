import { randomUUID } from 'crypto'
import {
  KAIROS_BUILD_STATE_VERSION,
  type KairosBuildTracerSlice,
} from './buildState.js'
import {
  getProjectKairosBuildManifestPath,
  getProjectKairosBuildResultPath,
  getProjectKairosBuildSpecPath,
  getProjectKairosBuildTranscriptPointerPath,
} from './paths.js'
import { createStateWriter, type StateWriter } from './stateWriter.js'

export type CreateDraftBuildDeps = {
  generateBuildId?: () => string
  now?: () => Date
  createWriter?: () => Promise<StateWriter>
}

export type DraftBuildResult = {
  buildId: string
  projectDir: string
  specPath: string
  manifestPath: string
}

const TITLE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'application',
  'build',
  'create',
  'for',
  'me',
  'please',
  'the',
  'to',
])

function toTitleCaseWord(word: string): string {
  return `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`
}

export function deriveDraftTitle(brief: string): string {
  const normalizedWords = brief
    .trim()
    .replace(/[^A-Za-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const forIndex = normalizedWords.findIndex(
    word => word.toLowerCase() === 'for',
  )
  const titleSource =
    forIndex > 0 ? normalizedWords.slice(0, forIndex) : normalizedWords
  const words = titleSource
    .filter(word => !TITLE_STOP_WORDS.has(word.toLowerCase()))
    .slice(0, 6)

  if (words.length === 0) return 'KAIROS-SF Draft PRD'
  return words.map(toTitleCaseWord).join(' ')
}

function quoteBrief(brief: string): string {
  return brief
    .trim()
    .split(/\r?\n/)
    .map(line => `> ${line.trim()}`)
    .join('\n')
}

export function createDraftTracerSlices(): KairosBuildTracerSlice[] {
  return [
    {
      id: 'TB-1',
      title: 'Record intake skeleton',
      testFirst:
        'creating the minimum valid record persists it and shows it in a list',
      implement:
        'add the smallest form, persistence path, and list view needed for one record',
    },
    {
      id: 'TB-2',
      title: 'Review workflow path',
      testFirst:
        'a pending record can move to approved or rejected with an audit entry',
      implement:
        'add status transitions, reviewer action controls, and audit recording',
    },
    {
      id: 'TB-3',
      title: 'Validation and role guardrails',
      testFirst:
        'incomplete records are rejected and unauthorized actions are blocked',
      implement:
        'add required-field validation and role checks at the command boundary',
    },
  ]
}

function renderTracerSlices(slices: KairosBuildTracerSlice[]): string[] {
  return slices.flatMap((slice, index) => [
    `${index + 1}. ${slice.id}: ${slice.title}`,
    `   - Test first: ${slice.testFirst}.`,
    `   - Implement: ${slice.implement}.`,
  ])
}

export function renderDraftPrd(brief: string): string {
  const trimmedBrief = brief.trim()
  const title = deriveDraftTitle(trimmedBrief)
  const tracerSlices = createDraftTracerSlices()
  return [
    `# ${title}`,
    '',
    '**Status:** Draft',
    '**Source:** `/kairos build` brief',
    '',
    '## Original Brief',
    '',
    quoteBrief(trimmedBrief),
    '',
    '## Problem',
    '',
    'Capture the business problem, affected users, and current workflow pain.',
    '',
    '## Users',
    '',
    '- Primary operator',
    '- Reviewer or approver',
    '- Administrator',
    '',
    '## Goals',
    '',
    '- Convert the brief into a buildable internal workflow app.',
    '- Preserve spec clauses as future eval and audit anchors.',
    '- Identify missing compliance, data, and approval requirements before build.',
    '',
    '## Non-Goals',
    '',
    '- Native mobile application.',
    '- Broad "any app" generation beyond the selected workflow.',
    '',
    '## Functional Requirements',
    '',
    '- Intake form or record creation flow.',
    '- List/detail views for submitted records.',
    '- Role-aware approval or status workflow where applicable.',
    '- Audit trail for important state changes.',
    '',
    '## Acceptance Checks',
    '',
    '- A user can create a valid record from the primary form.',
    '- A reviewer can find and act on pending records.',
    '- Invalid or incomplete data is rejected with clear feedback.',
    '- Important changes are visible in an audit trail.',
    '',
    '## Tracer Bullet Slices',
    '',
    ...renderTracerSlices(tracerSlices),
    '',
    '## Clarifying Questions',
    '',
    '1. Who are the exact user roles and approvers?',
    '2. What fields are required, optional, or sensitive?',
    '3. What notifications or integrations are required?',
    '4. What retention, export, or compliance constraints apply?',
    '',
    '## Traceability Seed',
    '',
    `- BRIEF-1: ${trimmedBrief}`,
    '',
  ].join('\n')
}

export async function createDraftBuild(
  projectDir: string,
  brief: string,
  deps: CreateDraftBuildDeps = {},
): Promise<DraftBuildResult> {
  const trimmedBrief = brief.trim()
  if (trimmedBrief.length === 0) {
    throw new Error('Build brief is required')
  }

  const generateBuildId = deps.generateBuildId ?? randomUUID
  const now = deps.now ?? (() => new Date())
  const createWriter = deps.createWriter ?? createStateWriter
  const buildId = generateBuildId()
  const timestamp = now().toISOString()
  const writer = await createWriter()
  const specPath = getProjectKairosBuildSpecPath(projectDir, buildId)
  const manifestPath = getProjectKairosBuildManifestPath(projectDir, buildId)
  const title = deriveDraftTitle(trimmedBrief)
  const tracerSlices = createDraftTracerSlices()

  await writer.writeBuildManifest(projectDir, {
    version: KAIROS_BUILD_STATE_VERSION,
    buildId,
    projectDir,
    tenantId: 'local',
    title,
    brief: trimmedBrief,
    tracerSlices,
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
    specPath,
    resultPath: getProjectKairosBuildResultPath(projectDir, buildId),
    transcriptPointerPath: getProjectKairosBuildTranscriptPointerPath(
      projectDir,
      buildId,
    ),
  })
  await writer.writeBuildSpec(projectDir, buildId, renderDraftPrd(trimmedBrief))
  await writer.appendBuildEvent(projectDir, buildId, {
    version: KAIROS_BUILD_STATE_VERSION,
    kind: 'build_created',
    buildId,
    tenantId: 'local',
    t: timestamp,
    status: 'draft',
  })
  await writer.appendBuildEvent(projectDir, buildId, {
    version: KAIROS_BUILD_STATE_VERSION,
    kind: 'spec_written',
    buildId,
    tenantId: 'local',
    t: timestamp,
    specPath,
  })

  return {
    buildId,
    projectDir,
    specPath,
    manifestPath,
  }
}
