import { randomUUID } from 'crypto'
import { KAIROS_BUILD_STATE_VERSION } from './buildState.js'
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

export function renderDraftPrd(brief: string): string {
  const trimmedBrief = brief.trim()
  return [
    '# KAIROS-SF Draft PRD',
    '',
    '## Original Brief',
    '',
    trimmedBrief,
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
    '## Open Questions',
    '',
    '1. Who are the exact user roles and approvers?',
    '2. What fields are required, optional, or sensitive?',
    '3. What notifications or integrations are required?',
    '4. What retention, export, or compliance constraints apply?',
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

  await writer.writeBuildManifest(projectDir, {
    version: KAIROS_BUILD_STATE_VERSION,
    buildId,
    projectDir,
    tenantId: 'local',
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
