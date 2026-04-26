import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash, createHmac } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getProjectRoot,
  setProjectRoot,
} from '../bootstrap/state.js'
import {
  calculateKairosAuditExportHash,
  calculateKairosBuildAuditMerkleRoot,
} from '../daemon/kairos/buildAudit.js'
import {
  getProjectKairosBuildAuditAnchorPath,
  getProjectKairosBuildDir,
  getProjectKairosBuildEventsPath,
  getProjectKairosBuildManifestPath,
  getProjectKairosBuildResultPath,
  getProjectKairosBuildSpecPath,
} from '../daemon/kairos/paths.js'
import { createStateWriter } from '../daemon/kairos/stateWriter.js'
import { writeCronTasks } from '../utils/cronTasks.js'
import {
  __resetKairosBuildDepsForTesting,
  __resetKairosCloudSyncDepsForTesting,
  __setKairosBuildDepsForTesting,
  __setKairosCloudSyncDepsForTesting,
  default as kairosCommand,
  runKairosCommand,
} from './kairos.js'
import { __resetKairosCloudLifecycleDepsForTesting } from '../daemon/kairos/cloudLifecycle.js'

const TEMP_DIRS: string[] = []
let originalProjectRoot: string

function makeTempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-cmd-config-'))
  TEMP_DIRS.push(dir)
  return dir
}

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-cmd-project-'))
  TEMP_DIRS.push(dir)
  return dir
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function seedKairosProjectState(projectDir: string): Promise<void> {
  const writer = await createStateWriter()
  await writer.ensureProjectDir(projectDir)
  await writer.writeGlobalStatus({
    kind: 'kairos',
    state: 'idle',
    pid: 4242,
    startedAt: '2026-04-22T12:00:00Z',
    updatedAt: '2026-04-22T12:01:00Z',
    projects: 1,
    lastEventAt: '2026-04-22T12:01:30Z',
  })
  await writer.writeProjectStatus({
    projectDir,
    running: true,
    dirty: true,
    pendingCount: 2,
    lastEvent: 'overlap_coalesced',
    nextFireAt: 1_746_000_000_000,
    updatedAt: '2026-04-22T12:01:15Z',
  })
  await writer.writeGlobalCosts({
    totalUSD: 0.25,
    totalTurns: 3,
    runs: 2,
    updatedAt: '2026-04-22T12:01:00Z',
  })
  await writer.writeProjectCosts(projectDir, {
    totalUSD: 0.15,
    totalTurns: 2,
    runs: 1,
    updatedAt: '2026-04-22T12:01:00Z',
  })
  await writeCronTasks(
    [
      {
        id: 'demo1234',
        cron: '5 12 22 4 *',
        prompt: 'demo task',
        createdAt: Date.now(),
      },
    ],
    projectDir,
  )
}

beforeEach(() => {
  originalProjectRoot = getProjectRoot()
  process.env.CLAUDE_CONFIG_DIR = makeTempConfigDir()
})

afterEach(() => {
  setProjectRoot(originalProjectRoot)
  __resetKairosBuildDepsForTesting()
  __resetKairosCloudLifecycleDepsForTesting()
  __resetKairosCloudSyncDepsForTesting()
  delete process.env.CLAUDE_CONFIG_DIR
  delete process.env.KAIROS_DASHBOARD_URL
  delete process.env.KAIROS_AUDIT_SIGNING_KEY
  delete process.env.KAIROS_AUDIT_SIGNING_KEY_ID
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('/kairos command', () => {
  test('prints help when called with no args', async () => {
    const out = await runKairosCommand('')
    expect(out).toContain('/kairos status')
    expect(out).toContain('/kairos opt-in')
    expect(out).toContain('/kairos demo')
    expect(out).toContain('/kairos build')
    expect(out).toContain('/kairos builds')
    expect(out).toContain('/kairos build-show')
    expect(out).toContain('/kairos build-events')
    expect(out).toContain('/kairos build-slices')
    expect(out).toContain('/kairos build-select')
    expect(out).toContain('/kairos build-select-next')
    expect(out).toContain('/kairos build-select-next-prompt')
    expect(out).toContain('/kairos build-next')
    expect(out).toContain('/kairos build-complete-slice')
    expect(out).toContain('/kairos build-acceptance')
    expect(out).toContain('/kairos build-questions')
    expect(out).toContain('/kairos build-redact-answer')
    expect(out).toContain('/kairos build-requirements')
    expect(out).toContain('/kairos build-summary')
    expect(out).toContain('/kairos build-progress')
    expect(out).toContain('/kairos build-assumptions')
    expect(out).toContain('/kairos build-risks')
    expect(out).toContain('/kairos build-goals')
    expect(out).toContain('/kairos build-non-goals')
    expect(out).toContain('/kairos build-users')
    expect(out).toContain('/kairos build-problem')
    expect(out).toContain('/kairos build-traceability')
    expect(out).toContain('/kairos build-prd-outline')
    expect(out).toContain('/kairos build-audit-verify')
    expect(out).toContain('/kairos build-audit-export')
    expect(out).toContain('/kairos build-audit-siem-export')
    expect(out).toContain('/kairos export tenant')
    expect(out).toContain('/kairos export tenant-verify')
    expect(out).toContain('/kairos import tenant')
    expect(out).toContain('/kairos cloud deploy')
    expect(out).toContain('/kairos cloud-sync')
  })

  test('prints help for unknown subcommands', async () => {
    const out = await runKairosCommand('bogus')
    expect(out).toContain('Usage:')
  })

  test('command metadata advertises tenant portability commands', () => {
    expect(kairosCommand.argumentHint).toContain('export tenant')
    expect(kairosCommand.argumentHint).toContain('export tenant-verify')
    expect(kairosCommand.argumentHint).toContain('import tenant')
  })

  test('opt-in and opt-out modify projects.json', async () => {
    const projectDir = makeProjectDir()
    const projectsFile = join(
      process.env.CLAUDE_CONFIG_DIR as string,
      'kairos',
      'projects.json',
    )

    const optIn = await runKairosCommand(`opt-in ${projectDir}`)
    expect(optIn).toContain('Opted in')
    expect(readJson(projectsFile)).toEqual({ projects: [projectDir] })

    const optOut = await runKairosCommand(`opt-out ${projectDir}`)
    expect(optOut).toContain('Opted out')
    expect(readJson(projectsFile)).toEqual({ projects: [] })
  })

  test('list shows opted-in projects', async () => {
    const a = makeProjectDir()
    const b = makeProjectDir()
    await runKairosCommand(`opt-in ${a}`)
    await runKairosCommand(`opt-in ${b}`)

    const out = await runKairosCommand('list')
    expect(out).toContain(a)
    expect(out).toContain(b)
  })

  test('list reports empty state clearly', async () => {
    const out = await runKairosCommand('list')
    expect(out).toBe('No projects opted in.')
  })

  test('demo writes a durable file-backed one-shot cron task', async () => {
    const projectDir = makeProjectDir()

    const out = await runKairosCommand(`demo ${projectDir}`)
    expect(out).toContain('scheduled')

    const tasksPath = join(projectDir, '.claude', 'scheduled_tasks.json')
    const body = readJson(tasksPath) as {
      tasks: Array<{ id: string; cron: string; prompt: string; recurring?: boolean }>
    }
    expect(body.tasks).toHaveLength(1)
    const [task] = body.tasks
    expect(task.recurring).toBeUndefined()
    expect(task.prompt).toContain('KAIROS dashboard demo')
    // Cron must be a valid 5-field expression targeting a specific minute.
    expect(task.cron.split(/\s+/)).toHaveLength(5)
  })

  test('build requires a brief', async () => {
    const out = await runKairosCommand('build')
    expect(out).toBe('Usage: /kairos build [projectDir] <brief>')
  })

  test('build turns a vague brief into a persisted draft spec build', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'build-test-1',
      now: () => new Date('2026-04-25T18:30:00.000Z'),
    })

    const out = await runKairosCommand(
      `build ${projectDir} leave request approval app for hourly workers`,
    )

    expect(out).toContain('Build draft created: build-test-1')
    expect(out).toContain(`project: ${projectDir}`)
    expect(out).toContain('status: draft')
    expect(out).toContain(getProjectKairosBuildSpecPath(projectDir, 'build-test-1'))
    expect(out).toContain(
      `show command: /kairos build-show ${projectDir} build-test-1`,
    )
    expect(out).toContain(
      `readiness command: /kairos build-readiness ${projectDir} build-test-1`,
    )
    expect(out).toContain(
      `next command: /kairos build-select-next-prompt ${projectDir} build-test-1`,
    )

    expect(readJson(getProjectKairosBuildManifestPath(projectDir, 'build-test-1'))).toMatchObject({
      version: 1,
      buildId: 'build-test-1',
      projectDir,
      tenantId: 'local',
      title: 'Leave Request Approval App',
      brief: 'leave request approval app for hourly workers',
      acceptanceChecks: [
        'A user can create a valid record from the primary form.',
        'A reviewer can find and act on pending records.',
        'Invalid or incomplete data is rejected with clear feedback.',
        'Important changes are visible in an audit trail.',
      ],
      clarifyingQuestions: [
        'Who are the exact user roles and approvers?',
        'What fields are required, optional, or sensitive?',
        'What notifications or integrations are required?',
        'What retention, export, or compliance constraints apply?',
      ],
      functionalRequirements: [
        'Intake form or record creation flow.',
        'List/detail views for submitted records.',
        'Role-aware approval or status workflow where applicable.',
        'Audit trail for important state changes.',
      ],
      goals: [
        'Convert the brief into a buildable internal workflow app.',
        'Preserve spec clauses as future eval and audit anchors.',
        'Identify missing compliance, data, and approval requirements before build.',
      ],
      nonGoals: [
        'Native mobile application.',
        'Broad "any app" generation beyond the selected workflow.',
      ],
      users: [
        'Primary operator',
        'Reviewer or approver',
        'Administrator',
      ],
      problem:
        'Capture the business problem, affected users, and current workflow pain.',
      traceabilitySeeds: [
        {
          id: 'BRIEF-1',
          source: 'brief',
          text: 'leave request approval app for hourly workers',
        },
      ],
      assumptions: [
        'The first build targets a browser-based internal workflow tool.',
        'A human reviewer will confirm roles, fields, and compliance constraints before implementation.',
        'Local single-tenant state is acceptable until deployment requirements are known.',
        'Auditability is required for approval or status changes.',
      ],
      risks: [
        'Unknown data fields can cause rework in the first implementation slice.',
        'Unconfirmed approver roles can weaken workflow and permission tests.',
        'Missing integration expectations can hide notification or export work.',
        'Compliance requirements may change storage, audit, and retention design.',
      ],
      tracerSlices: [
        {
          id: 'TB-1',
          title: 'Record intake skeleton',
        },
        {
          id: 'TB-2',
          title: 'Review workflow path',
        },
        {
          id: 'TB-3',
          title: 'Validation and role guardrails',
        },
      ],
      status: 'draft',
      createdAt: '2026-04-25T18:30:00.000Z',
      updatedAt: '2026-04-25T18:30:00.000Z',
    })

    const spec = readFileSync(
      getProjectKairosBuildSpecPath(projectDir, 'build-test-1'),
      'utf8',
    )
    expect(spec).toContain('# Leave Request Approval App')
    expect(spec).toContain('leave request approval app for hourly workers')
    expect(spec).toContain('## Clarifying Questions')

    const events = readFileSync(
      getProjectKairosBuildEventsPath(projectDir, 'build-test-1'),
      'utf8',
    )
    expect(events).toContain('"kind":"build_created"')
    expect(events).toContain('"kind":"spec_written"')
  })

  test('builds lists persisted build manifests newest first', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'older-build',
      now: () => new Date('2026-04-25T18:30:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} vendor onboarding form`)

    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'newer-build',
      now: () => new Date('2026-04-25T18:35:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request approval app`)
    await runKairosCommand(`build-select ${projectDir} newer-build TB-2`)

    const out = await runKairosCommand(`builds ${projectDir}`)
    const lines = out.split('\n')
    expect(lines[0]).toBe(`Builds for ${projectDir}:`)
    expect(lines[1]).toContain(
      '- newer-build [draft] Leave Request Approval App selected=TB-2 updated=',
    )
    expect(lines[2]).toBe(
      `  show command: /kairos build-show ${projectDir} newer-build`,
    )
    expect(lines[3]).toBe(
      `  summary command: /kairos build-summary ${projectDir} newer-build`,
    )
    expect(lines[4]).toBe(
      '- older-build [draft] Vendor Onboarding Form updated=2026-04-25T18:30:00.000Z',
    )
    expect(lines[5]).toBe(
      `  show command: /kairos build-show ${projectDir} older-build`,
    )
    expect(lines[6]).toBe(
      `  summary command: /kairos build-summary ${projectDir} older-build`,
    )
  })

  test('builds reports empty state clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(`builds ${projectDir}`)
    expect(out).toBe(`No builds found for ${projectDir}.`)
  })

  test('build-show prints one persisted build with its draft spec', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'show-build',
      now: () => new Date('2026-04-25T18:40:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} vendor onboarding form`)

    const out = await runKairosCommand(`build-show ${projectDir} show-build`)
    expect(out).toContain('Build: show-build')
    expect(out).toContain(`project: ${projectDir}`)
    expect(out).toContain('title: Vendor Onboarding Form')
    expect(out).toContain('status: draft')
    expect(out).toContain('selected slice: —')
    expect(out).toContain('brief: vendor onboarding form')
    expect(out).toContain(
      `summary command: /kairos build-summary ${projectDir} show-build`,
    )
    expect(out).toContain(
      `progress command: /kairos build-progress ${projectDir} show-build`,
    )
    expect(out).toContain(
      `readiness command: /kairos build-readiness ${projectDir} show-build`,
    )
    expect(out).toContain('--- spec ---')
    expect(out).toContain('# Vendor Onboarding Form')
  })

  test('build-show prints the selected tracer bullet when present', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'show-selected-build',
      now: () => new Date('2026-04-25T18:42:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(`build-select ${projectDir} show-selected-build TB-3`)

    const out = await runKairosCommand(`build-show ${projectDir} show-selected-build`)
    expect(out).toContain('Build: show-selected-build')
    expect(out).toContain('selected slice: TB-3')
  })

  test('build-show reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(`build-show ${projectDir} missing-build`)
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-events prints persisted build lifecycle events', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'events-build',
      now: () => new Date('2026-04-25T18:45:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(`build-events ${projectDir} events-build`)
    const lines = out.split('\n')
    expect(lines[0]).toBe('Events for events-build:')
    const firstEvent = lines[1]?.match(
      /^- 2026-04-25T18:45:00\.000Z build_created status=draft audit=([a-f0-9]{64}) prev=genesis$/,
    )
    expect(firstEvent).not.toBeNull()
    const secondEvent = lines[2]?.match(
      /^- 2026-04-25T18:45:00\.000Z spec_written spec=\[redacted\] audit=([a-f0-9]{64}) prev=([a-f0-9]{64})$/,
    )
    expect(secondEvent).not.toBeNull()
    expect(secondEvent?.[2]).toBe(firstEvent?.[1])
    expect(lines[3]).toBe(
      `summary command: /kairos build-summary ${projectDir} events-build`,
    )
    expect(lines[4]).toBe(
      `progress command: /kairos build-progress ${projectDir} events-build`,
    )
    expect(lines).toHaveLength(5)
  })

  test('build-events redacts sensitive persisted payload values', async () => {
    const projectDir = makeProjectDir()
    const buildId = 'redacted-events-build'
    __setKairosBuildDepsForTesting({
      generateBuildId: () => buildId,
      now: () => new Date('2026-04-25T18:47:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(
      `build-answer ${projectDir} ${buildId} 2 ssn 123-45-6789`,
    )
    const writer = await createStateWriter()
    await writer.appendBuildEvent(projectDir, buildId, {
      version: 1,
      kind: 'build_result_written',
      buildId,
      tenantId: 'local',
      t: '2026-04-25T18:48:00.000Z',
      status: 'succeeded',
      resultPath: getProjectKairosBuildResultPath(projectDir, buildId),
    })
    await writer.appendBuildEvent(projectDir, buildId, {
      version: 1,
      kind: 'build_failed',
      buildId,
      tenantId: 'local',
      t: '2026-04-25T18:49:00.000Z',
      errorMessage:
        'failed reading /Users/alice/customer-one/secrets.txt for jane@example.com',
    })

    const out = await runKairosCommand(
      `build-events ${projectDir} ${buildId} 10`,
    )

    expect(out).toContain('spec_written spec=[redacted]')
    expect(out).toContain(
      'clarifying_question_answered question=2 answer=[redacted]',
    )
    expect(out).toContain(
      'build_result_written status=succeeded result=[redacted]',
    )
    expect(out).toContain('build_failed error=[redacted]')
    expect(out).not.toContain(getProjectKairosBuildSpecPath(projectDir, buildId))
    expect(out).not.toContain(getProjectKairosBuildResultPath(projectDir, buildId))
    expect(out).not.toContain('ssn 123-45-6789')
    expect(out).not.toContain('/Users/alice/customer-one/secrets.txt')
    expect(out).not.toContain('jane@example.com')
    const persistedEvents = readFileSync(
      getProjectKairosBuildEventsPath(projectDir, buildId),
      'utf8',
    )
    expect(persistedEvents).not.toContain(
      getProjectKairosBuildSpecPath(projectDir, buildId),
    )
    expect(persistedEvents).not.toContain(
      getProjectKairosBuildResultPath(projectDir, buildId),
    )
    expect(persistedEvents).not.toContain(
      '/Users/alice/customer-one/secrets.txt',
    )
    expect(persistedEvents).not.toContain('jane@example.com')
  })

  test('build-events filters persisted events by kind', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'events-build',
      now: () => new Date('2026-04-25T18:46:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(`build-select ${projectDir} events-build TB-1`)
    await runKairosCommand(`build-complete-slice ${projectDir} events-build`)

    const out = await runKairosCommand(
      `build-events ${projectDir} events-build --kind slice_completed`,
    )
    const lines = out.split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe('Events for events-build kind=slice_completed:')
    expect(lines[1]).toContain(
      'slice_completed slice=TB-1 title=Record intake skeleton',
    )
    expect(lines[2]).toBe(
      `summary command: /kairos build-summary ${projectDir} events-build`,
    )
    expect(lines[3]).toBe(
      `progress command: /kairos build-progress ${projectDir} events-build`,
    )
  })

  test('build-events reports supported kinds for an invalid kind filter', async () => {
    const out = await runKairosCommand('build-events events-build --kind nope')
    expect(out.split('\n')).toEqual([
      'Unknown build event kind: nope',
      'Supported kinds: build_created, build_status_changed, spec_written, slice_selected, next_slice_prompt_rendered, slice_completed, clarifying_question_answered, clarifying_question_answer_redacted, agent_event_recorded, build_result_written, build_failed',
      'Usage: /kairos build-events [projectDir] <buildId> [lines] [--kind <kind>]',
    ])
  })

  test('build-events reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(`build-events ${projectDir} missing-build`)
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-audit-verify validates persisted event hash chains', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'audit-build',
      now: () => new Date('2026-04-25T20:10:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-audit-verify ${projectDir} audit-build`,
    )
    const lines = out.split('\n')
    expect(lines[0]).toBe('Build audit chain valid for audit-build.')
    expect(lines[1]).toBe('events: 2')
    expect(lines[2]).toMatch(/^last audit hash: [a-f0-9]{64}$/)
    expect(lines[3]).toBe(
      `events command: /kairos build-events ${projectDir} audit-build`,
    )
    expect(lines).toHaveLength(4)
  })

  test('build-audit-verify reports a tampered event hash', async () => {
    const projectDir = makeProjectDir()
    const zeroHash =
      '0000000000000000000000000000000000000000000000000000000000000000'
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tampered-audit-build',
      now: () => new Date('2026-04-25T20:11:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    const eventsPath = getProjectKairosBuildEventsPath(
      projectDir,
      'tampered-audit-build',
    )
    writeFileSync(
      eventsPath,
      readFileSync(eventsPath, 'utf8').replace(
        /"auditHash":"[a-f0-9]{64}"/,
        `"auditHash":"${zeroHash}"`,
      ),
      'utf8',
    )

    const out = await runKairosCommand(
      `build-audit-verify ${projectDir} tampered-audit-build`,
    )
    expect(out.split('\n')).toEqual([
      'Build audit chain invalid for tampered-audit-build.',
      'event: 1',
      'reason: hash mismatch',
      `actual: ${zeroHash}`,
      `events command: /kairos build-events ${projectDir} tampered-audit-build`,
    ])
  })

  test('build-audit-export emits chain metadata without event payload fields', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'audit-export-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-audit-export ${projectDir} audit-export-build`,
    )
    const auditExport = JSON.parse(out) as {
      version: number
      buildId: string
      projectDir?: string
      projectDirHash: string
      tenantId: string
      valid: boolean
      eventCount: number
      lastHash: string
      merkleRoot: string
      exportHash: string
      redactionPolicy: {
        version: number
        eventFields: string[]
      }
      auditSignature: {
        version: number
        status: string
        reason?: string
      }
      events: Array<{
        eventNumber: number
        kind: string
        t: string
        auditPrevHash: string | null
        auditHash: string
      }>
    }

    expect(auditExport).toMatchObject({
      version: 1,
      buildId: 'audit-export-build',
      tenantId: 'local',
      valid: true,
      eventCount: 2,
    })
    expect(auditExport.redactionPolicy).toEqual({
      version: 1,
      eventFields: [
        'clarifying_question_answered.answer',
        'spec_written.specPath',
        'build_result_written.resultPath',
        'build_failed.errorMessage',
      ],
    })
    expect(auditExport.auditSignature).toEqual({
      version: 1,
      status: 'unsigned',
      reason: 'KAIROS_AUDIT_SIGNING_KEY not configured',
    })
    expect(auditExport.projectDir).toBeUndefined()
    expect(auditExport.projectDirHash).toBe(
      calculateKairosAuditExportHash({
        field: 'projectDir',
        value: projectDir,
      }),
    )
    expect(auditExport.lastHash).toMatch(/^[a-f0-9]{64}$/)
    expect(auditExport.merkleRoot).toBe(
      calculateKairosBuildAuditMerkleRoot(
        auditExport.events.map(event => event.auditHash),
      ),
    )
    expect(auditExport.exportHash).toBe(
      calculateKairosAuditExportHash({
        ...auditExport,
        exportHash: undefined,
        auditSignature: undefined,
      }),
    )
    expect(auditExport.events).toHaveLength(2)
    expect(auditExport.events[0]).toMatchObject({
      eventNumber: 1,
      kind: 'build_created',
      t: '2026-04-25T20:12:00.000Z',
      auditPrevHash: null,
    })
    expect(auditExport.events[0]?.auditHash).toMatch(/^[a-f0-9]{64}$/)
    expect(auditExport.events[1]).toMatchObject({
      eventNumber: 2,
      kind: 'spec_written',
      t: '2026-04-25T20:12:00.000Z',
      auditPrevHash: auditExport.events[0]?.auditHash,
      auditHash: auditExport.lastHash,
    })
    expect(out).not.toContain(
      getProjectKairosBuildSpecPath(projectDir, 'audit-export-build'),
    )
  })

  test('build-audit-export signs the export hash when a signing key is configured', async () => {
    const projectDir = makeProjectDir()
    process.env.KAIROS_AUDIT_SIGNING_KEY = 'test-signing-key'
    process.env.KAIROS_AUDIT_SIGNING_KEY_ID = 'test-key-1'
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'signed-audit-export-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} signed export`)

    const out = await runKairosCommand(
      `build-audit-export ${projectDir} signed-audit-export-build`,
    )
    const auditExport = JSON.parse(out) as {
      exportHash: string
      auditSignature: {
        version: number
        status: string
        algorithm: string
        keyId: string
        signature: string
      }
    }

    expect(auditExport.auditSignature).toEqual({
      version: 1,
      status: 'signed',
      algorithm: 'hmac-sha256',
      keyId: 'test-key-1',
      signature: createHmac('sha256', 'test-signing-key')
        .update(auditExport.exportHash)
        .digest('hex'),
    })
  })

  test('build-audit-export includes erasure summary without raw answers', async () => {
    const projectDir = makeProjectDir()
    const buildId = 'audit-export-erasure-build'
    __setKairosBuildDepsForTesting({
      generateBuildId: () => buildId,
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} export erasure`)
    await runKairosCommand(
      `build-answer ${projectDir} ${buildId} 1 employee manager and HR approver`,
    )
    await runKairosCommand(
      `build-answer ${projectDir} ${buildId} 2 dates reason and sensitive notes`,
    )
    await runKairosCommand(`build-redact-answer ${projectDir} ${buildId} 2`)

    const out = await runKairosCommand(
      `build-audit-export ${projectDir} ${buildId}`,
    )
    const auditExport = JSON.parse(out) as {
      erasureSummary: {
        clarifyingAnswers: {
          answered: number
          redacted: number
          erasable: number
        }
        redactionEvents: number
      }
    }

    expect(out).not.toContain('dates reason and sensitive notes')
    expect(auditExport.erasureSummary).toEqual({
      clarifyingAnswers: {
        answered: 2,
        redacted: 1,
        erasable: 1,
      },
      redactionEvents: 1,
    })
  })

  test('build-audit-siem-export emits payload-free JSONL records for SIEM ingestion', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'siem-export-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} siem export`)

    const out = await runKairosCommand(
      `build-audit-siem-export ${projectDir} siem-export-build`,
    )
    const records = out.split('\n').map(line => JSON.parse(line)) as Array<{
      recordType: string
      version?: number
      buildId?: string
      projectDir?: string
      projectDirHash?: string
      tenantId?: string
      valid?: boolean
      eventCount?: number
      lastHash?: string
      merkleRoot?: string
      exportHash?: string
      redactionPolicy?: {
        version: number
        eventFields: string[]
      }
      auditSignature?: {
        version: number
        status: string
        reason?: string
      }
      erasureSummary?: {
        clarifyingAnswers: {
          answered: number
          redacted: number
          erasable: number
        }
        redactionEvents: number
      }
      eventNumber?: number
      kind?: string
      t?: string
      auditPrevHash?: string | null
      auditHash?: string
    }>

    expect(records).toHaveLength(3)
    expect(records[0]).toMatchObject({
      recordType: 'kairos_build_audit_summary',
      version: 1,
      buildId: 'siem-export-build',
      tenantId: 'local',
      valid: true,
      eventCount: 2,
      auditSignature: {
        version: 1,
        status: 'unsigned',
        reason: 'KAIROS_AUDIT_SIGNING_KEY not configured',
      },
      erasureSummary: {
        clarifyingAnswers: {
          answered: 0,
          redacted: 0,
          erasable: 0,
        },
        redactionEvents: 0,
      },
      redactionPolicy: {
        version: 1,
        eventFields: [
          'clarifying_question_answered.answer',
          'spec_written.specPath',
          'build_result_written.resultPath',
          'build_failed.errorMessage',
        ],
      },
    })
    expect(records[0]?.projectDir).toBeUndefined()
    expect(records[0]?.projectDirHash).toBe(
      calculateKairosAuditExportHash({
        field: 'projectDir',
        value: projectDir,
      }),
    )
    expect(records[0]?.lastHash).toMatch(/^[a-f0-9]{64}$/)
    expect(records[0]?.merkleRoot).toBe(
      calculateKairosBuildAuditMerkleRoot(
        records.slice(1).map(record => record.auditHash as string),
      ),
    )
    expect(records[0]?.exportHash).toMatch(/^[a-f0-9]{64}$/)
    expect(records[1]).toMatchObject({
      recordType: 'kairos_build_audit_event',
      buildId: 'siem-export-build',
      tenantId: 'local',
      eventNumber: 1,
      kind: 'build_created',
      t: '2026-04-25T20:12:00.000Z',
      auditPrevHash: null,
    })
    expect(records[1]?.auditHash).toMatch(/^[a-f0-9]{64}$/)
    expect(records[2]).toMatchObject({
      recordType: 'kairos_build_audit_event',
      buildId: 'siem-export-build',
      tenantId: 'local',
      eventNumber: 2,
      kind: 'spec_written',
      t: '2026-04-25T20:12:00.000Z',
      auditPrevHash: records[1]?.auditHash,
      auditHash: records[0]?.lastHash,
    })
    expect(out).not.toContain(projectDir)
    expect(out).not.toContain(
      getProjectKairosBuildSpecPath(projectDir, 'siem-export-build'),
    )
    expect(out).not.toContain('siem export')
  })

  test('export tenant emits a portable spec and audit proof envelope without local paths', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-export-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} tenant export`)

    const out = await runKairosCommand(`export tenant ${projectDir}`)
    const tenantExport = JSON.parse(out) as {
      version: number
      exportType: string
      tenantId: string
      projectDir?: string
      projectDirHash: string
      buildCount: number
      archiveHash: string
      builds: Array<{
        buildId: string
        tenantId: string
        title: string
        status: string
        createdAt: string
        updatedAt: string
        selectedSliceId: string | null
        completedSliceIds: string[]
        spec: {
          format: string
          body: string
        }
        audit: {
          valid: boolean
          eventCount: number
          lastHash: string
          merkleRoot: string
          exportHash: string
          auditSignature: {
            version: number
            status: string
            reason?: string
          }
          events: Array<{
            eventNumber: number
            kind: string
            t: string
            auditPrevHash: string | null
            auditHash: string
          }>
        }
      }>
    }

    expect(tenantExport).toMatchObject({
      version: 1,
      exportType: 'kairos_tenant_portable_archive',
      tenantId: 'local',
      buildCount: 1,
    })
    expect(tenantExport.projectDir).toBeUndefined()
    expect(tenantExport.projectDirHash).toBe(
      calculateKairosAuditExportHash({
        field: 'projectDir',
        value: projectDir,
      }),
    )
    expect(tenantExport.archiveHash).toBe(
      calculateKairosAuditExportHash({
        ...tenantExport,
        archiveHash: undefined,
      }),
    )
    expect(tenantExport.builds).toHaveLength(1)
    expect(tenantExport.builds[0]).toMatchObject({
      buildId: 'tenant-export-build',
      tenantId: 'local',
      title: 'Tenant Export',
      status: 'draft',
      createdAt: '2026-04-25T20:12:00.000Z',
      updatedAt: '2026-04-25T20:12:00.000Z',
      selectedSliceId: null,
      completedSliceIds: [],
      spec: {
        format: 'markdown',
      },
      audit: {
        valid: true,
        eventCount: 2,
        auditSignature: {
          version: 1,
          status: 'unsigned',
          reason: 'KAIROS_AUDIT_SIGNING_KEY not configured',
        },
      },
    })
    expect(tenantExport.builds[0]?.spec.body).toContain('# Tenant Export')
    expect(tenantExport.builds[0]?.audit.lastHash).toMatch(/^[a-f0-9]{64}$/)
    expect(tenantExport.builds[0]?.audit.merkleRoot).toBe(
      calculateKairosBuildAuditMerkleRoot(
        tenantExport.builds[0].audit.events.map(event => event.auditHash),
      ),
    )
    expect(tenantExport.builds[0]?.audit.exportHash).toMatch(/^[a-f0-9]{64}$/)
    expect(tenantExport.builds[0]?.audit.events).toHaveLength(2)
    expect(tenantExport.builds[0]?.audit.events[0]).toMatchObject({
      eventNumber: 1,
      kind: 'build_created',
      t: '2026-04-25T20:12:00.000Z',
      auditPrevHash: null,
    })
    expect(tenantExport.builds[0]?.audit.events[1]).toMatchObject({
      eventNumber: 2,
      kind: 'spec_written',
      t: '2026-04-25T20:12:00.000Z',
      auditPrevHash: tenantExport.builds[0]?.audit.events[0]?.auditHash,
      auditHash: tenantExport.builds[0]?.audit.lastHash,
    })
    expect(out).not.toContain(projectDir)
    expect(out).not.toContain(
      getProjectKairosBuildSpecPath(projectDir, 'tenant-export-build'),
    )
  })

  test('export tenant-verify validates a portable tenant archive file', async () => {
    const projectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-export.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-export-verify-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} tenant export verify`)
    writeFileSync(
      exportPath,
      await runKairosCommand(`export tenant ${projectDir}`),
    )

    const out = await runKairosCommand(`export tenant-verify ${exportPath}`)

    expect(out.split('\n')).toEqual([
      'Tenant archive valid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-export-verify-build: audit=valid signature=unsigned merkle=valid',
    ])
  })

  test('export tenant includes generated app files when a build result points at an app dir', async () => {
    const projectDir = makeProjectDir()
    const appDir = join(projectDir, 'generated-app')
    const exportPath = join(makeTempConfigDir(), 'tenant-app-export.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-app-export-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} tenant generated app`)
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'src', 'index.ts'), 'export const app = true\n')
    const writer = await createStateWriter()
    await writer.writeBuildResult(projectDir, 'tenant-app-export-build', {
      version: 1,
      buildId: 'tenant-app-export-build',
      tenantId: 'local',
      status: 'succeeded',
      completedAt: '2026-04-25T20:13:00.000Z',
      summary: 'Generated app artifact ready.',
      appDir,
    })
    writeFileSync(
      exportPath,
      await runKairosCommand(`export tenant ${projectDir}`),
    )

    const tenantExport = JSON.parse(readFileSync(exportPath, 'utf8')) as {
      builds: Array<{
        generatedApps: Array<{
          appDirHash: string
          files: Array<{
            relativePath: string
            contentBase64: string
            sha256: string
            sizeBytes: number
          }>
        }>
      }>
    }

    expect(tenantExport.builds[0]?.generatedApps).toHaveLength(1)
    expect(tenantExport.builds[0]?.generatedApps[0]).toMatchObject({
      appDirHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(tenantExport.builds[0]?.generatedApps[0]?.files).toEqual([
      {
        relativePath: 'src/index.ts',
        contentBase64: Buffer.from('export const app = true\n').toString(
          'base64',
        ),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        sizeBytes: 24,
      },
    ])
    expect(readFileSync(exportPath, 'utf8')).not.toContain(appDir)
  })

  test('export tenant derives portable eval cases from acceptance checks', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-eval-export-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} tenant eval export`)

    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${projectDir}`),
    ) as {
      builds: Array<{
        evalCases: Array<{
          id: string
          source: string
          assertion: string
        }>
      }>
    }

    expect(tenantExport.builds[0]?.evalCases[0]).toEqual({
      id: 'tenant-eval-export-build-AC-1',
      source: 'acceptance_check',
      assertion: 'A user can create a valid record from the primary form.',
    })
  })

  test('export tenant derives a portable knowledge graph from PRD metadata', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-graph-export-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} tenant graph export`)

    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${projectDir}`),
    ) as {
      builds: Array<{
        knowledgeGraph: {
          nodes: Array<{
            id: string
            kind: string
            label: string
          }>
          edges: Array<{
            from: string
            to: string
            kind: string
          }>
        }
      }>
    }

    expect(tenantExport.builds[0]?.knowledgeGraph.nodes).toContainEqual({
      id: 'tenant-graph-export-build-FR-1',
      kind: 'functional_requirement',
      label: 'Intake form or record creation flow.',
    })
    expect(tenantExport.builds[0]?.knowledgeGraph.edges).toContainEqual({
      from: 'BRIEF-1',
      to: 'tenant-graph-export-build-FR-1',
      kind: 'supports',
    })
  })

  test('import tenant restores a portable archive into a fresh project', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant import`)
    writeFileSync(
      exportPath,
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    )

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )
    const showOut = await runKairosCommand(
      `build-show ${targetProjectDir} tenant-import-build`,
    )
    const verifyOut = await runKairosCommand(
      `build-audit-verify ${targetProjectDir} tenant-import-build`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive imported.',
      `project: ${targetProjectDir}`,
      'builds: 1',
      '- tenant-import-build [draft] Tenant Import',
      `verify command: /kairos build-audit-verify ${targetProjectDir} tenant-import-build`,
    ])
    expect(showOut).toContain('Build: tenant-import-build')
    expect(showOut).toContain(`project: ${targetProjectDir}`)
    expect(showOut).toContain('title: Tenant Import')
    expect(showOut).toContain('# Tenant Import')
    expect(showOut).not.toContain(sourceProjectDir)
    expect(verifyOut.split('\n')).toEqual([
      'Build audit chain valid for tenant-import-build.',
      'events: 2',
      expect.stringMatching(/^last audit hash: [a-f0-9]{64}$/),
      `events command: /kairos build-events ${targetProjectDir} tenant-import-build`,
    ])
  })

  test('import tenant restores structured PRD metadata', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-metadata.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-metadata-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} metadata restore`)
    writeFileSync(
      exportPath,
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    )

    await runKairosCommand(`import tenant ${exportPath} ${targetProjectDir}`)
    const requirementsOut = await runKairosCommand(
      `build-requirements ${targetProjectDir} tenant-import-metadata-build`,
    )
    const slicesOut = await runKairosCommand(
      `build-slices ${targetProjectDir} tenant-import-metadata-build`,
    )
    const traceabilityOut = await runKairosCommand(
      `build-traceability ${targetProjectDir} tenant-import-metadata-build`,
    )

    expect(requirementsOut).toContain(
      'Functional requirements for tenant-import-metadata-build:',
    )
    expect(requirementsOut).toContain('- Intake form or record creation flow.')
    expect(slicesOut).toContain('Slices for tenant-import-metadata-build:')
    expect(slicesOut).toContain('TB-1')
    expect(slicesOut).toContain('test:')
    expect(traceabilityOut).toContain('Traceability seeds for tenant-import-metadata-build:')
    expect(traceabilityOut).toContain('BRIEF-1')
  })

  test('import tenant restores clarifying question answers', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-answers.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-answers-build',
      now: () => new Date('2026-04-25T20:47:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} answer restore`)
    await runKairosCommand(
      `build-answer ${sourceProjectDir} tenant-import-answers-build 1 employee manager and HR approver`,
    )
    writeFileSync(
      exportPath,
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    )

    await runKairosCommand(`import tenant ${exportPath} ${targetProjectDir}`)
    const questionsOut = await runKairosCommand(
      `build-questions ${targetProjectDir} tenant-import-answers-build`,
    )

    expect(questionsOut.split('\n')).toEqual([
      'Clarifying questions for tenant-import-answers-build:',
      '1. Who are the exact user roles and approvers?',
      '   answer: employee manager and HR approver',
      '2. What fields are required, optional, or sensitive?',
      '3. What notifications or integrations are required?',
      '4. What retention, export, or compliance constraints apply?',
      `unanswered command: /kairos build-unanswered ${targetProjectDir} tenant-import-answers-build`,
      `next command: /kairos build-answer ${targetProjectDir} tenant-import-answers-build 2 <answer>`,
    ])
  })

  test('import tenant rejects unknown clarifying answer keys', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-unknown-answer-key-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-unknown-answer-key-tampered-build',
      now: () => new Date('2026-04-25T20:48:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} unknown answer key tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          clarifyingQuestionAnswers: Record<string, string>
        }
      }>
    }
    tenantExport.builds[0]!.metadata.clarifyingQuestionAnswers['99'] =
      'answer for a missing question'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-unknown-answer-key-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-unknown-answer-key-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects unexpected metadata fields', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-extra-metadata-field-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-extra-metadata-field-tampered-build',
      now: () => new Date('2026-04-25T20:24:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} metadata field tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: Record<string, unknown>
      }>
    }
    tenantExport.builds[0]!.metadata.unexpectedField =
      'not part of build metadata'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-extra-metadata-field-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-extra-metadata-field-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects unexpected spec fields', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-extra-spec-field-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-extra-spec-field-tampered-build',
      now: () => new Date('2026-04-25T20:26:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} spec field tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        spec: Record<string, unknown>
      }>
    }
    tenantExport.builds[0]!.spec.unexpectedField =
      'not part of build spec'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-extra-spec-field-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-extra-spec-field-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant restores generated app files', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const appDir = join(sourceProjectDir, 'generated-app')
    const exportPath = join(makeTempConfigDir(), 'tenant-import-app.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-app-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant app restore`)
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'src', 'index.ts'), 'export const app = true\n')
    const writer = await createStateWriter()
    await writer.writeBuildResult(sourceProjectDir, 'tenant-import-app-build', {
      version: 1,
      buildId: 'tenant-import-app-build',
      tenantId: 'local',
      status: 'succeeded',
      completedAt: '2026-04-25T20:13:00.000Z',
      summary: 'Generated app artifact ready.',
      appDir,
    })
    writeFileSync(
      exportPath,
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    )

    await runKairosCommand(`import tenant ${exportPath} ${targetProjectDir}`)
    const restoredAppDir = join(
      getProjectKairosBuildDir(targetProjectDir, 'tenant-import-app-build'),
      'generated-apps',
      '0',
    )
    const result = readJson(
      getProjectKairosBuildResultPath(
        targetProjectDir,
        'tenant-import-app-build',
      ),
    ) as { appDir: string }

    expect(readFileSync(join(restoredAppDir, 'src', 'index.ts'), 'utf8')).toBe(
      'export const app = true\n',
    )
    expect(result.appDir).toBe(restoredAppDir)
    expect(result.appDir).not.toContain(sourceProjectDir)
  })

  test('import tenant restores empty generated app files', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const appDir = join(sourceProjectDir, 'generated-app')
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-app-file.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-app-file-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty app file`)
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'src', 'empty.txt'), '')
    const writer = await createStateWriter()
    await writer.writeBuildResult(
      sourceProjectDir,
      'tenant-import-empty-app-file-build',
      {
        version: 1,
        buildId: 'tenant-import-empty-app-file-build',
        tenantId: 'local',
        status: 'succeeded',
        completedAt: '2026-04-25T20:13:00.000Z',
        summary: 'Generated app artifact ready.',
        appDir,
      },
    )
    writeFileSync(
      exportPath,
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    )

    await runKairosCommand(`import tenant ${exportPath} ${targetProjectDir}`)

    const restoredAppDir = join(
      getProjectKairosBuildDir(targetProjectDir, 'tenant-import-empty-app-file-build'),
      'generated-apps',
      '0',
    )
    expect(readFileSync(join(restoredAppDir, 'src', 'empty.txt'), 'utf8')).toBe(
      '',
    )
  })

  test('import tenant rejects unexpected generated app fields', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const appDir = join(sourceProjectDir, 'generated-app')
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-app-extra-field-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-app-extra-field-tampered-build',
      now: () => new Date('2026-04-25T20:14:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant app field tamper`)
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'src', 'index.ts'), 'export const app = true\n')
    const writer = await createStateWriter()
    await writer.writeBuildResult(
      sourceProjectDir,
      'tenant-import-app-extra-field-tampered-build',
      {
        version: 1,
        buildId: 'tenant-import-app-extra-field-tampered-build',
        tenantId: 'local',
        status: 'succeeded',
        completedAt: '2026-04-25T20:15:00.000Z',
        summary: 'Generated app artifact ready.',
        appDir,
      },
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        generatedApps: Array<Record<string, unknown>>
      }>
    }
    tenantExport.builds[0]!.generatedApps[0]!.unexpectedField =
      'not part of generated app archive'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-app-extra-field-tampered-build: audit=valid signature=unsigned merkle=valid apps=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildResultPath(
          targetProjectDir,
          'tenant-import-app-extra-field-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects malformed generated app directory hashes', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const appDir = join(sourceProjectDir, 'generated-app')
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-app-dir-hash-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-app-dir-hash-tampered-build',
      now: () => new Date('2026-04-25T20:18:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant app hash tamper`)
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'src', 'index.ts'), 'export const app = true\n')
    const writer = await createStateWriter()
    await writer.writeBuildResult(
      sourceProjectDir,
      'tenant-import-app-dir-hash-tampered-build',
      {
        version: 1,
        buildId: 'tenant-import-app-dir-hash-tampered-build',
        tenantId: 'local',
        status: 'succeeded',
        completedAt: '2026-04-25T20:19:00.000Z',
        summary: 'Generated app artifact ready.',
        appDir,
      },
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        generatedApps: Array<Record<string, unknown>>
      }>
    }
    tenantExport.builds[0]!.generatedApps[0]!.appDirHash = 42
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-app-dir-hash-tampered-build: audit=valid signature=unsigned merkle=valid apps=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildResultPath(
          targetProjectDir,
          'tenant-import-app-dir-hash-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects tampered generated app files', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const appDir = join(sourceProjectDir, 'generated-app')
    const exportPath = join(makeTempConfigDir(), 'tenant-import-app-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-app-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant app tamper`)
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'src', 'index.ts'), 'export const app = true\n')
    const writer = await createStateWriter()
    await writer.writeBuildResult(
      sourceProjectDir,
      'tenant-import-app-tampered-build',
      {
        version: 1,
        buildId: 'tenant-import-app-tampered-build',
        tenantId: 'local',
        status: 'succeeded',
        completedAt: '2026-04-25T20:13:00.000Z',
        summary: 'Generated app artifact ready.',
        appDir,
      },
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        generatedApps: Array<{
          files: Array<{ contentBase64: string }>
        }>
      }>
    }
    tenantExport.builds[0]!.generatedApps[0]!.files[0]!.contentBase64 =
      Buffer.from('export const app = false\n').toString('base64')
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-app-tampered-build: audit=valid signature=unsigned merkle=valid apps=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildResultPath(
          targetProjectDir,
          'tenant-import-app-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects unexpected generated app file fields', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const appDir = join(sourceProjectDir, 'generated-app')
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-app-file-extra-field-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-app-file-extra-field-tampered-build',
      now: () => new Date('2026-04-25T20:16:00.000Z'),
    })
    await runKairosCommand(
      `build ${sourceProjectDir} tenant app file field tamper`,
    )
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'src', 'index.ts'), 'export const app = true\n')
    const writer = await createStateWriter()
    await writer.writeBuildResult(
      sourceProjectDir,
      'tenant-import-app-file-extra-field-tampered-build',
      {
        version: 1,
        buildId: 'tenant-import-app-file-extra-field-tampered-build',
        tenantId: 'local',
        status: 'succeeded',
        completedAt: '2026-04-25T20:17:00.000Z',
        summary: 'Generated app artifact ready.',
        appDir,
      },
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        generatedApps: Array<{
          files: Array<Record<string, unknown>>
        }>
      }>
    }
    tenantExport.builds[0]!.generatedApps[0]!.files[0]!.unexpectedField =
      'not part of generated app file archive'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-app-file-extra-field-tampered-build: audit=valid signature=unsigned merkle=valid apps=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildResultPath(
          targetProjectDir,
          'tenant-import-app-file-extra-field-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects tampered generated app file sizes', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const appDir = join(sourceProjectDir, 'generated-app')
    const exportPath = join(makeTempConfigDir(), 'tenant-import-app-size-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-app-size-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant app size tamper`)
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'src', 'index.ts'), 'export const app = true\n')
    const writer = await createStateWriter()
    await writer.writeBuildResult(
      sourceProjectDir,
      'tenant-import-app-size-tampered-build',
      {
        version: 1,
        buildId: 'tenant-import-app-size-tampered-build',
        tenantId: 'local',
        status: 'succeeded',
        completedAt: '2026-04-25T20:13:00.000Z',
        summary: 'Generated app artifact ready.',
        appDir,
      },
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        generatedApps: Array<{
          files: Array<{ sizeBytes: number }>
        }>
      }>
    }
    tenantExport.builds[0]!.generatedApps[0]!.files[0]!.sizeBytes = 999
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-app-size-tampered-build: audit=valid signature=unsigned merkle=valid apps=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildResultPath(
          targetProjectDir,
          'tenant-import-app-size-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects malformed generated app base64 payloads', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const appDir = join(sourceProjectDir, 'generated-app')
    const exportPath = join(makeTempConfigDir(), 'tenant-import-app-base64-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-app-base64-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant app base64 tamper`)
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'src', 'index.ts'), 'export const app = true\n')
    const writer = await createStateWriter()
    await writer.writeBuildResult(
      sourceProjectDir,
      'tenant-import-app-base64-tampered-build',
      {
        version: 1,
        buildId: 'tenant-import-app-base64-tampered-build',
        tenantId: 'local',
        status: 'succeeded',
        completedAt: '2026-04-25T20:13:00.000Z',
        summary: 'Generated app artifact ready.',
        appDir,
      },
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        generatedApps: Array<{
          files: Array<{
            contentBase64: string
            sha256: string
            sizeBytes: number
          }>
        }>
      }>
    }
    const decodedLenientPayload = Buffer.from('not valid base64', 'base64')
    const archivedFile = tenantExport.builds[0]!.generatedApps[0]!.files[0]!
    archivedFile.contentBase64 = 'not valid base64'
    archivedFile.sha256 = createHash('sha256')
      .update(decodedLenientPayload)
      .digest('hex')
    archivedFile.sizeBytes = decodedLenientPayload.byteLength
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-app-base64-tampered-build: audit=valid signature=unsigned merkle=valid apps=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildResultPath(
          targetProjectDir,
          'tenant-import-app-base64-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects duplicate generated app file paths', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const appDir = join(sourceProjectDir, 'generated-app')
    const exportPath = join(makeTempConfigDir(), 'tenant-import-app-duplicate-path.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-app-duplicate-path-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant app duplicate path`)
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'src', 'index.ts'), 'export const app = true\n')
    const writer = await createStateWriter()
    await writer.writeBuildResult(
      sourceProjectDir,
      'tenant-import-app-duplicate-path-build',
      {
        version: 1,
        buildId: 'tenant-import-app-duplicate-path-build',
        tenantId: 'local',
        status: 'succeeded',
        completedAt: '2026-04-25T20:13:00.000Z',
        summary: 'Generated app artifact ready.',
        appDir,
      },
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        generatedApps: Array<{
          files: Array<Record<string, unknown>>
        }>
      }>
    }
    const files = tenantExport.builds[0]!.generatedApps[0]!.files
    files.push({ ...files[0]! })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-app-duplicate-path-build: audit=valid signature=unsigned merkle=valid apps=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildResultPath(
          targetProjectDir,
          'tenant-import-app-duplicate-path-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects generated app archives for another build', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const appDir = join(sourceProjectDir, 'generated-app')
    const exportPath = join(makeTempConfigDir(), 'tenant-import-app-build-id-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-app-build-id-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant app build id tamper`)
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'src', 'index.ts'), 'export const app = true\n')
    const writer = await createStateWriter()
    await writer.writeBuildResult(
      sourceProjectDir,
      'tenant-import-app-build-id-tampered-build',
      {
        version: 1,
        buildId: 'tenant-import-app-build-id-tampered-build',
        tenantId: 'local',
        status: 'succeeded',
        completedAt: '2026-04-25T20:13:00.000Z',
        summary: 'Generated app artifact ready.',
        appDir,
      },
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        generatedApps: Array<{ buildId: string }>
      }>
    }
    tenantExport.builds[0]!.generatedApps[0]!.buildId = 'other-build'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-app-build-id-tampered-build: audit=valid signature=unsigned merkle=valid apps=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildResultPath(
          targetProjectDir,
          'tenant-import-app-build-id-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-object generated app entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-app-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-app-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant app shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        generatedApps: unknown[]
      }>
    }
    tenantExport.builds[0]!.generatedApps.push('not-a-generated-app-object')
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-app-shape-tampered-build: audit=valid signature=unsigned merkle=valid apps=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-app-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-object generated app file entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const appDir = join(sourceProjectDir, 'generated-app')
    const exportPath = join(makeTempConfigDir(), 'tenant-import-app-file-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-app-file-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant app file shape tamper`)
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'src', 'index.ts'), 'export const app = true\n')
    const writer = await createStateWriter()
    await writer.writeBuildResult(
      sourceProjectDir,
      'tenant-import-app-file-shape-tampered-build',
      {
        version: 1,
        buildId: 'tenant-import-app-file-shape-tampered-build',
        tenantId: 'local',
        status: 'succeeded',
        completedAt: '2026-04-25T20:13:00.000Z',
        summary: 'Generated app artifact ready.',
        appDir,
      },
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        generatedApps: Array<{
          files: unknown[]
        }>
      }>
    }
    tenantExport.builds[0]!.generatedApps[0]!.files.push(
      'not-a-generated-app-file-object',
    )
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-app-file-shape-tampered-build: audit=valid signature=unsigned merkle=valid apps=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildResultPath(
          targetProjectDir,
          'tenant-import-app-file-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects malformed generated app statuses', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const appDir = join(sourceProjectDir, 'generated-app')
    const exportPath = join(makeTempConfigDir(), 'tenant-import-app-status-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-app-status-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant app status tamper`)
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'src', 'index.ts'), 'export const app = true\n')
    const writer = await createStateWriter()
    await writer.writeBuildResult(
      sourceProjectDir,
      'tenant-import-app-status-tampered-build',
      {
        version: 1,
        buildId: 'tenant-import-app-status-tampered-build',
        tenantId: 'local',
        status: 'succeeded',
        completedAt: '2026-04-25T20:13:00.000Z',
        summary: 'Generated app artifact ready.',
        appDir,
      },
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        generatedApps: Array<{ status: string }>
      }>
    }
    tenantExport.builds[0]!.generatedApps[0]!.status = 'not-a-build-status'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-app-status-tampered-build: audit=valid signature=unsigned merkle=valid apps=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildResultPath(
          targetProjectDir,
          'tenant-import-app-status-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty generated app summaries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const appDir = join(sourceProjectDir, 'generated-app')
    const exportPath = join(makeTempConfigDir(), 'tenant-import-app-summary-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-app-summary-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant app summary tamper`)
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'src', 'index.ts'), 'export const app = true\n')
    const writer = await createStateWriter()
    await writer.writeBuildResult(
      sourceProjectDir,
      'tenant-import-app-summary-tampered-build',
      {
        version: 1,
        buildId: 'tenant-import-app-summary-tampered-build',
        tenantId: 'local',
        status: 'succeeded',
        completedAt: '2026-04-25T20:13:00.000Z',
        summary: 'Generated app artifact ready.',
        appDir,
      },
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        generatedApps: Array<{ summary: string }>
      }>
    }
    tenantExport.builds[0]!.generatedApps[0]!.summary = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-app-summary-tampered-build: audit=valid signature=unsigned merkle=valid apps=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildResultPath(
          targetProjectDir,
          'tenant-import-app-summary-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty generated app completion times', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const appDir = join(sourceProjectDir, 'generated-app')
    const exportPath = join(makeTempConfigDir(), 'tenant-import-app-completed-at-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-app-completed-at-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant app completed at tamper`)
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'src', 'index.ts'), 'export const app = true\n')
    const writer = await createStateWriter()
    await writer.writeBuildResult(
      sourceProjectDir,
      'tenant-import-app-completed-at-tampered-build',
      {
        version: 1,
        buildId: 'tenant-import-app-completed-at-tampered-build',
        tenantId: 'local',
        status: 'succeeded',
        completedAt: '2026-04-25T20:13:00.000Z',
        summary: 'Generated app artifact ready.',
        appDir,
      },
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        generatedApps: Array<{ completedAt: string }>
      }>
    }
    tenantExport.builds[0]!.generatedApps[0]!.completedAt = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-app-completed-at-tampered-build: audit=valid signature=unsigned merkle=valid apps=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildResultPath(
          targetProjectDir,
          'tenant-import-app-completed-at-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects tampered eval cases', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-eval-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-eval-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant eval tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        evalCases: Array<{ assertion: string }>
      }>
    }
    tenantExport.builds[0]!.evalCases[0]!.assertion =
      'A changed eval assertion should not import.'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-eval-tampered-build: audit=valid signature=unsigned merkle=valid evals=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-eval-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-object eval case entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-eval-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-eval-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant eval shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        evalCases: unknown[]
      }>
    }
    tenantExport.builds[0]!.evalCases.push('not-an-eval-case-object')
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-eval-shape-tampered-build: audit=valid signature=unsigned merkle=valid evals=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-eval-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-string acceptance check metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-acceptance-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-acceptance-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant acceptance shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          acceptanceChecks: unknown[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.acceptanceChecks.push({
      assertion: 'not-a-string-acceptance-check',
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-acceptance-shape-tampered-build: audit=valid signature=unsigned merkle=valid evals=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-acceptance-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty acceptance check metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-acceptance-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-acceptance-tampered-build',
      now: () => new Date('2026-04-25T20:36:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty acceptance tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        evalCases: Array<{
          assertion: string
        }>
        metadata: {
          acceptanceChecks: string[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.acceptanceChecks[0] = ''
    tenantExport.builds[0]!.evalCases[0]!.assertion = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-acceptance-tampered-build: audit=valid signature=unsigned merkle=valid evals=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-acceptance-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects tampered knowledge graphs', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-graph-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-graph-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant graph tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        knowledgeGraph: {
          nodes: Array<{ label: string }>
        }
      }>
    }
    tenantExport.builds[0]!.knowledgeGraph.nodes[0]!.label =
      'Tampered graph node.'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-graph-tampered-build: audit=valid signature=unsigned merkle=valid graph=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-graph-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-string requirement metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-requirement-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-requirement-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant requirement shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          functionalRequirements: unknown[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.functionalRequirements.push({
      requirement: 'not-a-string-functional-requirement',
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-requirement-shape-tampered-build: audit=valid signature=unsigned merkle=valid graph=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-requirement-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty requirement metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-requirement-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-requirement-tampered-build',
      now: () => new Date('2026-04-25T20:37:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty requirement tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        knowledgeGraph: {
          nodes: Array<{ kind: string; label: string }>
        }
        metadata: {
          functionalRequirements: string[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.functionalRequirements[0] = ''
    tenantExport.builds[0]!.knowledgeGraph.nodes.find(
      node => node.kind === 'functional_requirement',
    )!.label = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-requirement-tampered-build: audit=valid signature=unsigned merkle=valid graph=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-requirement-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-object tracer slice metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-tracer-slice-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-tracer-slice-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant tracer slice shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          tracerSlices: unknown[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.tracerSlices.push(
      'not-a-tracer-slice-object',
    )
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-tracer-slice-shape-tampered-build: audit=valid signature=unsigned merkle=valid graph=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-tracer-slice-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty tracer slice metadata fields', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-tracer-slice-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-tracer-slice-tampered-build',
      now: () => new Date('2026-04-25T20:39:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty tracer slice tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        knowledgeGraph: {
          nodes: Array<{ id: string; kind: string }>
        }
        metadata: {
          tracerSlices: Array<{
            id: string
            title: string
          }>
        }
      }>
    }
    const sliceId = tenantExport.builds[0]!.metadata.tracerSlices[0]!.id
    tenantExport.builds[0]!.metadata.tracerSlices[0]!.title = ''
    tenantExport.builds[0]!.knowledgeGraph.nodes =
      tenantExport.builds[0]!.knowledgeGraph.nodes.filter(
        node => !(node.kind === 'tracer_slice' && node.id === sliceId),
      )
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-tracer-slice-tampered-build: audit=valid signature=unsigned merkle=valid graph=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-tracer-slice-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects duplicate tracer slice ids', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-duplicate-tracer-slice-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-duplicate-tracer-slice-tampered-build',
      now: () => new Date('2026-04-25T20:45:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant duplicate tracer slice tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        knowledgeGraph: {
          nodes: Array<{
            id: string
            kind: string
            label: string
          }>
        }
        metadata: {
          tracerSlices: Array<{
            id: string
            title: string
            testFirst: string
            implement: string
          }>
        }
      }>
    }
    const slice = tenantExport.builds[0]!.metadata.tracerSlices[0]!
    tenantExport.builds[0]!.metadata.tracerSlices.push({ ...slice })
    tenantExport.builds[0]!.knowledgeGraph.nodes.push({
      id: slice.id,
      kind: 'tracer_slice',
      label: slice.title,
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-duplicate-tracer-slice-tampered-build: audit=valid signature=unsigned merkle=valid graph=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-duplicate-tracer-slice-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-object traceability seed metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-traceability-seed-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-traceability-seed-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant seed shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          traceabilitySeeds: unknown[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.traceabilitySeeds.push(
      'not-a-traceability-seed-object',
    )
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-traceability-seed-shape-tampered-build: audit=valid signature=unsigned merkle=valid graph=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-traceability-seed-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty traceability seed metadata fields', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-traceability-seed-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-traceability-seed-tampered-build',
      now: () => new Date('2026-04-25T20:40:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty seed tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        knowledgeGraph: {
          nodes: Array<{ id: string; kind: string }>
          edges: Array<{ from: string; to: string }>
        }
        metadata: {
          traceabilitySeeds: Array<{
            id: string
            text: string
          }>
        }
      }>
    }
    const seedId = tenantExport.builds[0]!.metadata.traceabilitySeeds[0]!.id
    tenantExport.builds[0]!.metadata.traceabilitySeeds[0]!.text = ''
    tenantExport.builds[0]!.knowledgeGraph.nodes =
      tenantExport.builds[0]!.knowledgeGraph.nodes.filter(
        node => !(node.kind === 'traceability_seed' && node.id === seedId),
      )
    tenantExport.builds[0]!.knowledgeGraph.edges =
      tenantExport.builds[0]!.knowledgeGraph.edges.filter(
        edge => edge.from !== seedId && edge.to !== seedId,
      )
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-traceability-seed-tampered-build: audit=valid signature=unsigned merkle=valid graph=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-traceability-seed-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects duplicate traceability seed ids', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-duplicate-traceability-seed-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-duplicate-traceability-seed-tampered-build',
      now: () => new Date('2026-04-25T20:46:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant duplicate seed tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        knowledgeGraph: {
          nodes: Array<{
            id: string
            kind: string
            label: string
            source?: string
          }>
        }
        metadata: {
          traceabilitySeeds: Array<{
            id: string
            source: string
            text: string
          }>
        }
      }>
    }
    const seed = tenantExport.builds[0]!.metadata.traceabilitySeeds[0]!
    const seedNodeIndex = tenantExport.builds[0]!.knowledgeGraph.nodes.findIndex(
      node => node.kind === 'traceability_seed' && node.id === seed.id,
    )
    tenantExport.builds[0]!.metadata.traceabilitySeeds.push({ ...seed })
    tenantExport.builds[0]!.knowledgeGraph.nodes.splice(seedNodeIndex + 1, 0, {
      id: seed.id,
      kind: 'traceability_seed',
      label: seed.text,
      source: seed.source,
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-duplicate-traceability-seed-tampered-build: audit=valid signature=unsigned merkle=valid graph=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-duplicate-traceability-seed-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-string completed slice entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-completed-slice-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-completed-slice-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant completed slice shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        completedSliceIds: unknown[]
      }>
    }
    tenantExport.builds[0]!.completedSliceIds.push({
      id: 'not-a-string-completed-slice',
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-completed-slice-shape-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-completed-slice-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty completed slice entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-completed-slice-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-completed-slice-tampered-build',
      now: () => new Date('2026-04-25T20:38:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty completed slice tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        completedSliceIds: string[]
      }>
    }
    tenantExport.builds[0]!.completedSliceIds.push('')
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-completed-slice-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-completed-slice-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects unknown completed slice ids', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-unknown-completed-slice-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-unknown-completed-slice-tampered-build',
      now: () => new Date('2026-04-25T20:43:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant unknown completed slice tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        completedSliceIds: string[]
      }>
    }
    tenantExport.builds[0]!.completedSliceIds = ['unknown-tracer-slice']
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-unknown-completed-slice-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-unknown-completed-slice-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects duplicate completed slice ids', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-duplicate-completed-slice-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-duplicate-completed-slice-tampered-build',
      now: () => new Date('2026-04-25T20:44:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant duplicate completed slice tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        completedSliceIds: string[]
        metadata: {
          tracerSlices: Array<{ id: string }>
        }
      }>
    }
    const sliceId = tenantExport.builds[0]!.metadata.tracerSlices[0]!.id
    tenantExport.builds[0]!.completedSliceIds = [sliceId, sliceId]
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-duplicate-completed-slice-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-duplicate-completed-slice-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-string user metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-users-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-users-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant users shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          users: unknown[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.users.push({
      user: 'not-a-string-user',
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-users-shape-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-users-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty user metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-users-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-users-tampered-build',
      now: () => new Date('2026-04-25T20:30:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty users tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          users: string[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.users[0] = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-users-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-users-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-string goal metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-goals-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-goals-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant goals shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          goals: unknown[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.goals.push({
      goal: 'not-a-string-goal',
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-goals-shape-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-goals-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty goal metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-goals-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-goals-tampered-build',
      now: () => new Date('2026-04-25T20:31:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty goals tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          goals: string[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.goals[0] = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-goals-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-goals-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-string non-goal metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-non-goals-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-non-goals-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant non goals shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          nonGoals: unknown[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.nonGoals.push({
      nonGoal: 'not-a-string-non-goal',
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-non-goals-shape-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-non-goals-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty non-goal metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-non-goals-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-non-goals-tampered-build',
      now: () => new Date('2026-04-25T20:32:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty non goals tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          nonGoals: string[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.nonGoals[0] = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-non-goals-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-non-goals-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-string clarifying question metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-questions-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-questions-shape-tampered-build',
      now: () => new Date('2026-04-25T20:13:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant questions shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          clarifyingQuestions: unknown[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.clarifyingQuestions.push({
      question: 'not-a-string-question',
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-questions-shape-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-questions-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty clarifying question metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-questions-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-questions-tampered-build',
      now: () => new Date('2026-04-25T20:33:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty questions tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          clarifyingQuestions: string[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.clarifyingQuestions[0] = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-questions-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-questions-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-string assumption metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-assumptions-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-assumptions-shape-tampered-build',
      now: () => new Date('2026-04-25T20:14:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant assumptions shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          assumptions: unknown[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.assumptions.push({
      assumption: 'not-a-string-assumption',
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-assumptions-shape-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-assumptions-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty assumption metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-assumptions-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-assumptions-tampered-build',
      now: () => new Date('2026-04-25T20:34:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty assumptions tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          assumptions: string[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.assumptions[0] = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-assumptions-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-assumptions-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-string risk metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-risks-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-risks-shape-tampered-build',
      now: () => new Date('2026-04-25T20:15:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant risks shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          risks: unknown[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.risks.push({
      risk: 'not-a-string-risk',
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-risks-shape-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-risks-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty risk metadata entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-risks-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-risks-tampered-build',
      now: () => new Date('2026-04-25T20:35:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty risks tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          risks: string[]
        }
      }>
    }
    tenantExport.builds[0]!.metadata.risks[0] = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-risks-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-risks-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects malformed selected slice ids', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-selected-slice-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-selected-slice-shape-tampered-build',
      now: () => new Date('2026-04-25T20:16:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant selected slice shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        selectedSliceId: unknown
      }>
    }
    tenantExport.builds[0]!.selectedSliceId = {
      sliceId: 'not-a-string-selected-slice',
    }
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-selected-slice-shape-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-selected-slice-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty selected slice ids', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-selected-slice-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-selected-slice-tampered-build',
      now: () => new Date('2026-04-25T20:29:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty selected slice tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        selectedSliceId?: string | null
      }>
    }
    tenantExport.builds[0]!.selectedSliceId = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-selected-slice-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-selected-slice-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects unknown selected slice ids', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-unknown-selected-slice-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-unknown-selected-slice-tampered-build',
      now: () => new Date('2026-04-25T20:42:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant unknown selected slice tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        selectedSliceId?: string | null
      }>
    }
    tenantExport.builds[0]!.selectedSliceId = 'unknown-tracer-slice'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-unknown-selected-slice-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-unknown-selected-slice-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects unsupported build statuses', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-status-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-status-shape-tampered-build',
      now: () => new Date('2026-04-25T20:17:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant status shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        status: unknown
      }>
    }
    tenantExport.builds[0]!.status = 'archived'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-status-shape-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-status-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects malformed build titles', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-title-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-title-shape-tampered-build',
      now: () => new Date('2026-04-25T20:18:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant title shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        title: unknown
      }>
    }
    tenantExport.builds[0]!.title = {
      title: 'not-a-string-title',
    }
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-title-shape-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-title-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty build titles', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-title-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-title-tampered-build',
      now: () => new Date('2026-04-25T20:24:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty title tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        title: string
      }>
    }
    tenantExport.builds[0]!.title = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-title-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-title-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects malformed build creation times', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-created-at-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-created-at-shape-tampered-build',
      now: () => new Date('2026-04-25T20:19:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant created at shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        createdAt: unknown
      }>
    }
    tenantExport.builds[0]!.createdAt = {
      createdAt: 'not-a-string-created-at',
    }
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-created-at-shape-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-created-at-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty build creation times', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-created-at-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-created-at-tampered-build',
      now: () => new Date('2026-04-25T20:25:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty created at tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        createdAt: string
      }>
    }
    tenantExport.builds[0]!.createdAt = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-created-at-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-created-at-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects malformed build update times', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-updated-at-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-updated-at-shape-tampered-build',
      now: () => new Date('2026-04-25T20:20:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant updated at shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        updatedAt: unknown
      }>
    }
    tenantExport.builds[0]!.updatedAt = {
      updatedAt: 'not-a-string-updated-at',
    }
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-updated-at-shape-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-updated-at-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty build update times', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-updated-at-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-updated-at-tampered-build',
      now: () => new Date('2026-04-25T20:26:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty updated at tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        updatedAt: string
      }>
    }
    tenantExport.builds[0]!.updatedAt = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-updated-at-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-updated-at-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects malformed spec bodies', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-spec-body-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-spec-body-shape-tampered-build',
      now: () => new Date('2026-04-25T20:21:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant spec body shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        spec: {
          body: unknown
        }
      }>
    }
    tenantExport.builds[0]!.spec.body = {
      body: 'not-a-string-spec-body',
    }
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-spec-body-shape-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-spec-body-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty spec bodies', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-spec-body-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-spec-body-tampered-build',
      now: () => new Date('2026-04-25T20:41:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty spec body tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        spec: {
          body: string
        }
      }>
    }
    tenantExport.builds[0]!.spec.body = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-spec-body-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-spec-body-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects malformed brief metadata', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-brief-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-brief-shape-tampered-build',
      now: () => new Date('2026-04-25T20:22:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant brief shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          brief: unknown
        }
      }>
    }
    tenantExport.builds[0]!.metadata.brief = {
      brief: 'not-a-string-brief',
    }
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-brief-shape-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-brief-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty brief metadata', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-brief-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-brief-tampered-build',
      now: () => new Date('2026-04-25T20:27:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty brief tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          brief: string
        }
      }>
    }
    tenantExport.builds[0]!.metadata.brief = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-brief-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-brief-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects malformed problem metadata', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-problem-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-problem-shape-tampered-build',
      now: () => new Date('2026-04-25T20:23:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant problem shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          problem: unknown
        }
      }>
    }
    tenantExport.builds[0]!.metadata.problem = {
      problem: 'not-a-string-problem',
    }
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-problem-shape-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-problem-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty problem metadata', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-empty-problem-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-problem-tampered-build',
      now: () => new Date('2026-04-25T20:28:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty problem tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        metadata: {
          problem: string
        }
      }>
    }
    tenantExport.builds[0]!.metadata.problem = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-empty-problem-tampered-build: audit=valid signature=unsigned merkle=valid manifest=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-problem-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects unsupported archive export types', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-type-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-type-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant type tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      exportType: string
    }
    tenantExport.exportType = 'not_a_kairos_tenant_archive'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut).toBe(
      'Tenant archive invalid: unsupported exportType not_a_kairos_tenant_archive.',
    )
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-type-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects unsupported archive versions', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-version-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-version-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant version tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      version: number
    }
    tenantExport.version = 999
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut).toBe(
      'Tenant archive invalid: unsupported version 999.',
    )
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-version-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty archive tenant ids', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-empty-tenant-id-tampered.json',
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      tenantId: string
    }
    tenantExport.tenantId = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut).toBe(
      'Tenant archive invalid: tenantId must be a non-empty string.',
    )
  })

  test('import tenant rejects empty archive project hashes', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-empty-project-hash-tampered.json',
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      projectDirHash: string
    }
    tenantExport.projectDirHash = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut).toBe(
      'Tenant archive invalid: projectDirHash must be a non-empty string.',
    )
  })

  test('import tenant rejects unexpected archive envelope fields', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-extra-envelope-field-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-extra-envelope-field-tampered-build',
      now: () => new Date('2026-04-25T20:22:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant envelope extra`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as Record<string, unknown> & {
      archiveHash: string
    }
    tenantExport.unexpectedField = 'not part of the portable archive envelope'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut).toBe(
      'Tenant archive invalid: unexpected archive envelope fields.',
    )
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-extra-envelope-field-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects mismatched archive build counts', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-count-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-count-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant count tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      buildCount: number
    }
    tenantExport.buildCount = 999
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut).toBe(
      'Tenant archive invalid: buildCount mismatch 999 != 1.',
    )
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-count-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-object archive build entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-build-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-build-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant build shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: unknown[]
    }
    tenantExport.builds.push('not-a-build-object')
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut).toBe(
      'Tenant archive invalid: builds contains non-object entries.',
    )
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-build-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects unexpected build envelope fields', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-extra-build-field-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-extra-build-field-tampered-build',
      now: () => new Date('2026-04-25T20:23:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant build envelope extra`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<Record<string, unknown>>
    }
    tenantExport.builds[0]!.unexpectedField =
      'not part of a portable archive build'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut).toBe(
      'Tenant archive invalid: unexpected build envelope fields.',
    )
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-extra-build-field-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects mismatched archive tenant ids', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-tenant-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-tenant-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant id tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      tenantId: string
    }
    tenantExport.tenantId = 'other-tenant'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut).toBe(
      'Tenant archive invalid: tenantId mismatch other-tenant != local.',
    )
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-tenant-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects mismatched tenant ids across all builds', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-second-tenant-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-first-tenant-build',
      now: () => new Date('2026-04-25T20:17:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} first tenant build`)
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-second-tenant-build',
      now: () => new Date('2026-04-25T20:18:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} second tenant build`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        tenantId: string
      }>
    }
    tenantExport.builds[1]!.tenantId = 'other-tenant'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut).toBe(
      'Tenant archive invalid: tenantId mismatch local != other-tenant.',
    )
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-first-tenant-build',
        ),
      ),
    ).toBe(false)
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-second-tenant-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty build tenant ids', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-empty-build-tenant-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-build-tenant-tampered-build',
      now: () => new Date('2026-04-25T20:15:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant build id tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        tenantId: string
      }>
    }
    tenantExport.builds[0]!.tenantId = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut).toBe(
      'Tenant archive invalid: build tenantId must be a non-empty string.',
    )
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-build-tenant-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects empty build ids', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-empty-build-id-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-empty-build-id-tampered-build',
      now: () => new Date('2026-04-25T20:16:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant empty build id`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        buildId: string
      }>
    }
    tenantExport.builds[0]!.buildId = ''
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut).toBe(
      'Tenant archive invalid: buildId must be a non-empty string.',
    )
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-empty-build-id-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects duplicate archive build ids', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-duplicate-build.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-duplicate-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant duplicate build`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      buildCount: number
      builds: Array<Record<string, unknown>>
    }
    tenantExport.builds.push(tenantExport.builds[0]!)
    tenantExport.buildCount = tenantExport.builds.length
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut).toBe(
      'Tenant archive invalid: duplicate buildId tenant-import-duplicate-build.',
    )
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-duplicate-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects tampered audit event numbers', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-event-number-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-event-number-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant event tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      version: number
      projectDirHash: string
      builds: Array<{
        buildId: string
        tenantId: string
        audit: {
          valid: boolean
          eventCount: number
          lastHash: string
          merkleRoot: string
          exportHash: string
          erasureSummary: unknown
          redactionPolicy: unknown
          failure: unknown
          events: Array<{ eventNumber: number }>
        }
      }>
    }
    const build = tenantExport.builds[0]!
    build.audit.events[0]!.eventNumber = 99
    build.audit.exportHash = calculateKairosAuditExportHash({
      version: tenantExport.version,
      buildId: build.buildId,
      projectDirHash: tenantExport.projectDirHash,
      tenantId: build.tenantId,
      valid: build.audit.valid,
      eventCount: build.audit.eventCount,
      lastHash: build.audit.lastHash,
      merkleRoot: build.audit.merkleRoot,
      erasureSummary: build.audit.erasureSummary,
      redactionPolicy: build.audit.redactionPolicy,
      failure: build.audit.failure,
      events: build.audit.events,
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-event-number-tampered-build: audit=valid signature=unsigned merkle=valid restore=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-event-number-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects malformed audit validity flags', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-audit-valid-shape-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-audit-valid-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant audit valid tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      version: number
      projectDirHash: string
      builds: Array<{
        buildId: string
        tenantId: string
        audit: {
          valid: unknown
          eventCount: number
          lastHash: string
          merkleRoot: string
          exportHash: string
          erasureSummary: unknown
          redactionPolicy: unknown
          failure: unknown
          events: Array<Record<string, unknown>>
        }
      }>
    }
    const build = tenantExport.builds[0]!
    build.audit.valid = 'yes'
    build.audit.exportHash = calculateKairosAuditExportHash({
      version: tenantExport.version,
      buildId: build.buildId,
      projectDirHash: tenantExport.projectDirHash,
      tenantId: build.tenantId,
      valid: build.audit.valid,
      eventCount: build.audit.eventCount,
      lastHash: build.audit.lastHash,
      merkleRoot: build.audit.merkleRoot,
      erasureSummary: build.audit.erasureSummary,
      redactionPolicy: build.audit.redactionPolicy,
      failure: build.audit.failure,
      events: build.audit.events,
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-audit-valid-shape-tampered-build: audit=invalid signature=unsigned merkle=valid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-audit-valid-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects failure metadata on valid audit exports', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-audit-failure-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-audit-failure-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant audit failure tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      version: number
      projectDirHash: string
      builds: Array<{
        buildId: string
        tenantId: string
        audit: {
          valid: boolean
          eventCount: number
          lastHash: string
          merkleRoot: string
          exportHash: string
          erasureSummary: unknown
          redactionPolicy: unknown
          failure?: unknown
          events: Array<Record<string, unknown>>
        }
      }>
    }
    const build = tenantExport.builds[0]!
    build.audit.failure = { reason: 'fake failure on a valid audit export' }
    build.audit.exportHash = calculateKairosAuditExportHash({
      version: tenantExport.version,
      buildId: build.buildId,
      projectDirHash: tenantExport.projectDirHash,
      tenantId: build.tenantId,
      valid: build.audit.valid,
      eventCount: build.audit.eventCount,
      lastHash: build.audit.lastHash,
      merkleRoot: build.audit.merkleRoot,
      erasureSummary: build.audit.erasureSummary,
      redactionPolicy: build.audit.redactionPolicy,
      failure: build.audit.failure,
      events: build.audit.events,
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-audit-failure-tampered-build: audit=invalid signature=unsigned merkle=valid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-audit-failure-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects tampered audit redaction policies', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-audit-redaction-policy-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () =>
        'tenant-import-audit-redaction-policy-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(
      `build ${sourceProjectDir} tenant audit redaction policy tamper`,
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      version: number
      projectDirHash: string
      builds: Array<{
        buildId: string
        tenantId: string
        audit: {
          valid: boolean
          eventCount: number
          lastHash: string
          merkleRoot: string
          exportHash: string
          erasureSummary: unknown
          redactionPolicy: unknown
          failure: unknown
          events: Array<Record<string, unknown>>
        }
      }>
    }
    const build = tenantExport.builds[0]!
    build.audit.redactionPolicy = {
      version: 1,
      eventFields: ['clarifying_question_answered.answer'],
    }
    build.audit.exportHash = calculateKairosAuditExportHash({
      version: tenantExport.version,
      buildId: build.buildId,
      projectDirHash: tenantExport.projectDirHash,
      tenantId: build.tenantId,
      valid: build.audit.valid,
      eventCount: build.audit.eventCount,
      lastHash: build.audit.lastHash,
      merkleRoot: build.audit.merkleRoot,
      erasureSummary: build.audit.erasureSummary,
      redactionPolicy: build.audit.redactionPolicy,
      failure: build.audit.failure,
      events: build.audit.events,
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-audit-redaction-policy-tampered-build: audit=invalid signature=unsigned merkle=valid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-audit-redaction-policy-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects tampered audit erasure summaries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-audit-erasure-summary-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () =>
        'tenant-import-audit-erasure-summary-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(
      `build ${sourceProjectDir} tenant audit erasure summary tamper`,
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      version: number
      projectDirHash: string
      builds: Array<{
        buildId: string
        tenantId: string
        audit: {
          valid: boolean
          eventCount: number
          lastHash: string
          merkleRoot: string
          exportHash: string
          erasureSummary: unknown
          redactionPolicy: unknown
          failure: unknown
          events: Array<Record<string, unknown>>
        }
      }>
    }
    const build = tenantExport.builds[0]!
    build.audit.erasureSummary = {
      clarifyingAnswers: {
        answered: 99,
        redacted: 0,
        erasable: 99,
      },
      redactionEvents: 0,
    }
    build.audit.exportHash = calculateKairosAuditExportHash({
      version: tenantExport.version,
      buildId: build.buildId,
      projectDirHash: tenantExport.projectDirHash,
      tenantId: build.tenantId,
      valid: build.audit.valid,
      eventCount: build.audit.eventCount,
      lastHash: build.audit.lastHash,
      merkleRoot: build.audit.merkleRoot,
      erasureSummary: build.audit.erasureSummary,
      redactionPolicy: build.audit.redactionPolicy,
      failure: build.audit.failure,
      events: build.audit.events,
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-audit-erasure-summary-tampered-build: audit=invalid signature=unsigned merkle=valid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-audit-erasure-summary-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects malformed unsigned audit signatures', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-audit-signature-shape-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-audit-signature-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant audit signature tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        audit: {
          auditSignature: unknown
        }
      }>
    }
    tenantExport.builds[0]!.audit.auditSignature = {
      version: 999,
      status: 'unsigned',
      reason: 'unsigned for a different reason',
    }
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-audit-signature-shape-tampered-build: audit=valid signature=invalid merkle=valid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-audit-signature-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects audit signatures with extra metadata', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-audit-signature-extra-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-audit-signature-extra-tampered-build',
      now: () => new Date('2026-04-25T20:21:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant audit signature extra`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        audit: {
          auditSignature: Record<string, unknown>
        }
      }>
    }
    tenantExport.builds[0]!.audit.auditSignature.signature = 'not-applicable'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-audit-signature-extra-tampered-build: audit=valid signature=invalid merkle=valid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-audit-signature-extra-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects signed audit signature key relabeling', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-audit-signature-key-tampered.json',
    )
    process.env.KAIROS_AUDIT_SIGNING_KEY = 'tenant-signing-key'
    process.env.KAIROS_AUDIT_SIGNING_KEY_ID = 'tenant-key-1'
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-audit-signature-key-tampered-build',
      now: () => new Date('2026-04-25T20:19:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant audit key tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        audit: {
          auditSignature: {
            keyId: string
          }
        }
      }>
    }
    tenantExport.builds[0]!.audit.auditSignature.keyId = 'other-key'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-audit-signature-key-tampered-build: audit=valid signature=invalid merkle=valid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-audit-signature-key-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-object audit event entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-audit-event-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-audit-event-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant audit event shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        audit: {
          events: unknown[]
        }
      }>
    }
    tenantExport.builds[0]!.audit.events.push('not-an-audit-event-object')
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-audit-event-shape-tampered-build: audit=valid signature=unsigned merkle=valid events=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-audit-event-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects unexpected audit event fields', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-audit-event-extra-field-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-audit-event-extra-field-build',
      now: () => new Date('2026-04-25T20:22:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant audit event field`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      version: number
      projectDirHash: string
      builds: Array<{
        buildId: string
        tenantId: string
        audit: {
          valid: boolean
          eventCount: number
          lastHash: string
          merkleRoot: string
          exportHash: string
          erasureSummary: unknown
          redactionPolicy: unknown
          failure: unknown
          events: Array<Record<string, unknown>>
        }
      }>
    }
    const build = tenantExport.builds[0]!
    build.audit.events[0]!.unexpectedField = 'not part of audit event summary'
    build.audit.exportHash = calculateKairosAuditExportHash({
      version: tenantExport.version,
      buildId: build.buildId,
      projectDirHash: tenantExport.projectDirHash,
      tenantId: build.tenantId,
      valid: build.audit.valid,
      eventCount: build.audit.eventCount,
      lastHash: build.audit.lastHash,
      merkleRoot: build.audit.merkleRoot,
      erasureSummary: build.audit.erasureSummary,
      redactionPolicy: build.audit.redactionPolicy,
      failure: build.audit.failure,
      events: build.audit.events,
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-audit-event-extra-field-build: audit=valid signature=unsigned merkle=valid events=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-audit-event-extra-field-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects tampered audit event counts', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-event-count-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-event-count-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant event count tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      version: number
      projectDirHash: string
      builds: Array<{
        buildId: string
        tenantId: string
        audit: {
          valid: boolean
          eventCount: number
          lastHash: string
          merkleRoot: string
          exportHash: string
          erasureSummary: unknown
          redactionPolicy: unknown
          failure: unknown
          events: Array<Record<string, unknown>>
        }
      }>
    }
    const build = tenantExport.builds[0]!
    build.audit.eventCount = 99
    build.audit.exportHash = calculateKairosAuditExportHash({
      version: tenantExport.version,
      buildId: build.buildId,
      projectDirHash: tenantExport.projectDirHash,
      tenantId: build.tenantId,
      valid: build.audit.valid,
      eventCount: build.audit.eventCount,
      lastHash: build.audit.lastHash,
      merkleRoot: build.audit.merkleRoot,
      erasureSummary: build.audit.erasureSummary,
      redactionPolicy: build.audit.redactionPolicy,
      failure: build.audit.failure,
      events: build.audit.events,
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-event-count-tampered-build: audit=valid signature=unsigned merkle=valid events=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-event-count-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects tampered audit last hashes', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-last-hash-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-last-hash-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant last hash tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      version: number
      projectDirHash: string
      builds: Array<{
        buildId: string
        tenantId: string
        audit: {
          valid: boolean
          eventCount: number
          lastHash: string
          merkleRoot: string
          exportHash: string
          erasureSummary: unknown
          redactionPolicy: unknown
          failure: unknown
          events: Array<Record<string, unknown>>
        }
      }>
    }
    const build = tenantExport.builds[0]!
    build.audit.lastHash = '0'.repeat(64)
    build.audit.exportHash = calculateKairosAuditExportHash({
      version: tenantExport.version,
      buildId: build.buildId,
      projectDirHash: tenantExport.projectDirHash,
      tenantId: build.tenantId,
      valid: build.audit.valid,
      eventCount: build.audit.eventCount,
      lastHash: build.audit.lastHash,
      merkleRoot: build.audit.merkleRoot,
      erasureSummary: build.audit.erasureSummary,
      redactionPolicy: build.audit.redactionPolicy,
      failure: build.audit.failure,
      events: build.audit.events,
    })
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-last-hash-tampered-build: audit=valid signature=unsigned merkle=valid events=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-last-hash-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects tampered restore events', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        restore: {
          events: Array<{ status?: string }>
        }
      }>
    }
    const firstRestoreEvent = tenantExport.builds[0]?.restore.events[0]
    expect(firstRestoreEvent).toBeDefined()
    firstRestoreEvent!.status = 'queued'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-tampered-build: audit=valid signature=unsigned merkle=valid restore=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects non-object restore event entries', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'tenant-import-restore-event-shape-tampered.json')
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-restore-event-shape-tampered-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${sourceProjectDir} tenant restore event shape tamper`)
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        restore: {
          events: unknown[]
        }
      }>
    }
    tenantExport.builds[0]!.restore.events.push('not-a-restore-event-object')
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-restore-event-shape-tampered-build: audit=valid signature=unsigned merkle=valid restore=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-restore-event-shape-tampered-build',
        ),
      ),
    ).toBe(false)
  })

  test('import tenant rejects unexpected restore event fields', async () => {
    const sourceProjectDir = makeProjectDir()
    const targetProjectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'tenant-import-restore-event-extra-field-tampered.json',
    )
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'tenant-import-restore-event-extra-field-build',
      now: () => new Date('2026-04-25T20:24:00.000Z'),
    })
    await runKairosCommand(
      `build ${sourceProjectDir} tenant restore event field`,
    )
    const tenantExport = JSON.parse(
      await runKairosCommand(`export tenant ${sourceProjectDir}`),
    ) as {
      archiveHash: string
      builds: Array<{
        restore: {
          events: Array<Record<string, unknown>>
        }
      }>
    }
    tenantExport.builds[0]!.restore.events[0]!.unexpectedField =
      'not part of restore event'
    const { archiveHash: _archiveHash, ...archiveHashMaterial } = tenantExport
    tenantExport.archiveHash = calculateKairosAuditExportHash(
      archiveHashMaterial,
    )
    writeFileSync(exportPath, JSON.stringify(tenantExport, null, 2))

    const importOut = await runKairosCommand(
      `import tenant ${exportPath} ${targetProjectDir}`,
    )

    expect(importOut.split('\n')).toEqual([
      'Tenant archive invalid.',
      'archive hash: valid',
      'builds: 1',
      '- tenant-import-restore-event-extra-field-build: audit=valid signature=unsigned merkle=valid restore=invalid',
    ])
    expect(
      existsSync(
        getProjectKairosBuildManifestPath(
          targetProjectDir,
          'tenant-import-restore-event-extra-field-build',
        ),
      ),
    ).toBe(false)
  })

  test('build-audit-export-verify validates a signed audit export file', async () => {
    const projectDir = makeProjectDir()
    const exportPath = join(makeTempConfigDir(), 'audit-export.json')
    process.env.KAIROS_AUDIT_SIGNING_KEY = 'verify-signing-key'
    process.env.KAIROS_AUDIT_SIGNING_KEY_ID = 'verify-key-1'
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'verify-signed-audit-export-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} verify signed export`)
    writeFileSync(
      exportPath,
      await runKairosCommand(
        `build-audit-export ${projectDir} verify-signed-audit-export-build`,
      ),
    )

    const out = await runKairosCommand(`build-audit-export-verify ${exportPath}`)

    expect(out.split('\n')).toEqual([
      'Audit export valid for verify-signed-audit-export-build.',
      'export hash: valid',
      'audit signature: valid key=verify-key-1 algorithm=hmac-sha256',
    ])
  })

  test('build-audit-export-verify rejects signed key relabeling', async () => {
    const projectDir = makeProjectDir()
    const exportPath = join(
      makeTempConfigDir(),
      'audit-export-key-tampered.json',
    )
    process.env.KAIROS_AUDIT_SIGNING_KEY = 'verify-signing-key'
    process.env.KAIROS_AUDIT_SIGNING_KEY_ID = 'verify-key-1'
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'verify-signed-key-tampered-build',
      now: () => new Date('2026-04-25T20:20:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} verify key tamper`)
    const auditExport = JSON.parse(
      await runKairosCommand(
        `build-audit-export ${projectDir} verify-signed-key-tampered-build`,
      ),
    ) as {
      auditSignature: {
        keyId: string
      }
    }
    auditExport.auditSignature.keyId = 'other-key'
    writeFileSync(exportPath, JSON.stringify(auditExport, null, 2))

    const out = await runKairosCommand(`build-audit-export-verify ${exportPath}`)

    expect(out.split('\n')).toEqual([
      'Audit export invalid for verify-signed-key-tampered-build.',
      'export hash: valid',
      'audit signature: invalid reason=key id mismatch',
    ])
  })

  test('build-audit-anchor writes a filesystem anchor for the build audit root', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'anchor-audit-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} anchor export`)

    const out = await runKairosCommand(
      `build-audit-anchor ${projectDir} anchor-audit-build`,
    )
    const anchorPath = getProjectKairosBuildAuditAnchorPath(
      projectDir,
      'anchor-audit-build',
    )
    const anchor = readJson(anchorPath) as {
      version: number
      anchorType: string
      buildId: string
      tenantId: string
      anchoredAt: string
      eventCount: number
      lastHash: string
      merkleRoot: string
      exportHash: string
      anchorHash: string
    }

    expect(out.split('\n')).toEqual([
      'Audit anchor written for anchor-audit-build.',
      `anchor: ${anchorPath}`,
      `merkle root: ${anchor.merkleRoot}`,
      `export hash: ${anchor.exportHash}`,
    ])
    expect(anchor).toMatchObject({
      version: 1,
      anchorType: 'filesystem',
      buildId: 'anchor-audit-build',
      tenantId: 'local',
      anchoredAt: '2026-04-25T20:12:00.000Z',
      eventCount: 2,
    })
    expect(anchor.lastHash).toMatch(/^[a-f0-9]{64}$/)
    expect(anchor.merkleRoot).toMatch(/^[a-f0-9]{64}$/)
    expect(anchor.anchorHash).toBe(
      calculateKairosAuditExportHash({
        ...anchor,
        anchorHash: undefined,
      }),
    )
  })

  test('build-audit-anchor-verify validates a filesystem anchor against current build audit state', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'verify-anchor-build',
      now: () => new Date('2026-04-25T20:12:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} verify anchor`)
    await runKairosCommand(`build-audit-anchor ${projectDir} verify-anchor-build`)

    const out = await runKairosCommand(
      `build-audit-anchor-verify ${projectDir} verify-anchor-build`,
    )

    expect(out.split('\n')).toEqual([
      'Audit anchor valid for verify-anchor-build.',
      'anchor hash: valid',
      'export hash: valid',
      'audit signature: unsigned reason=KAIROS_AUDIT_SIGNING_KEY not configured',
    ])
  })

  test('build-slices prints selectable tracer bullets', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'slices-build',
      now: () => new Date('2026-04-25T18:50:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(`build-slices ${projectDir} slices-build`)
    expect(out.split('\n')).toEqual([
      'Slices for slices-build:',
      '- TB-1 Record intake skeleton',
      '  test: creating the minimum valid record persists it and shows it in a list',
      '  implement: add the smallest form, persistence path, and list view needed for one record',
      '- TB-2 Review workflow path',
      '  test: a pending record can move to approved or rejected with an audit entry',
      '  implement: add status transitions, reviewer action controls, and audit recording',
      '- TB-3 Validation and role guardrails',
      '  test: incomplete records are rejected and unauthorized actions are blocked',
      '  implement: add required-field validation and role checks at the command boundary',
      `select command: /kairos build-select ${projectDir} slices-build <sliceId>`,
      `next command: /kairos build-select-next-prompt ${projectDir} slices-build`,
    ])
  })

  test('build-slices reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(`build-slices ${projectDir} missing-build`)
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-acceptance prints persisted acceptance checks', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'acceptance-build',
      now: () => new Date('2026-04-25T19:05:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-acceptance ${projectDir} acceptance-build`,
    )
    expect(out.split('\n')).toEqual([
      'Acceptance checks for acceptance-build:',
      '- A user can create a valid record from the primary form.',
      '- A reviewer can find and act on pending records.',
      '- Invalid or incomplete data is rejected with clear feedback.',
      '- Important changes are visible in an audit trail.',
      `slices command: /kairos build-slices ${projectDir} acceptance-build`,
      `next command: /kairos build-select-next-prompt ${projectDir} acceptance-build`,
    ])
  })

  test('build-acceptance reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-acceptance ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-questions prints persisted clarifying questions', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'questions-build',
      now: () => new Date('2026-04-25T19:10:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-questions ${projectDir} questions-build`,
    )
    expect(out.split('\n')).toEqual([
      'Clarifying questions for questions-build:',
      '1. Who are the exact user roles and approvers?',
      '2. What fields are required, optional, or sensitive?',
      '3. What notifications or integrations are required?',
      '4. What retention, export, or compliance constraints apply?',
      `unanswered command: /kairos build-unanswered ${projectDir} questions-build`,
      `next command: /kairos build-answer ${projectDir} questions-build 1 <answer>`,
    ])
  })

  test('build-answer records a clarifying question answer', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'questions-build',
      now: () => new Date('2026-04-25T19:11:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const answerOut = await runKairosCommand(
      `build-answer ${projectDir} questions-build 1 employee manager and HR approver`,
    )
    expect(answerOut.split('\n')).toEqual([
      'Answered question 1 for questions-build: employee manager and HR approver',
      'unanswered clarifying questions remaining: 3',
      `next command: /kairos build-unanswered ${projectDir} questions-build`,
    ])

    const questionsOut = await runKairosCommand(
      `build-questions ${projectDir} questions-build`,
    )
    expect(questionsOut.split('\n')).toEqual([
      'Clarifying questions for questions-build:',
      '1. Who are the exact user roles and approvers?',
      '   answer: employee manager and HR approver',
      '2. What fields are required, optional, or sensitive?',
      '3. What notifications or integrations are required?',
      '4. What retention, export, or compliance constraints apply?',
      `unanswered command: /kairos build-unanswered ${projectDir} questions-build`,
      `next command: /kairos build-answer ${projectDir} questions-build 2 <answer>`,
    ])

    const eventsOut = await runKairosCommand(
      `build-events ${projectDir} questions-build --kind clarifying_question_answered`,
    )
    expect(eventsOut).toContain(
      'clarifying_question_answered question=1 answer=[redacted]',
    )
    expect(
      readFileSync(
        getProjectKairosBuildEventsPath(projectDir, 'questions-build'),
        'utf8',
      ),
    ).not.toContain('employee manager and HR approver')

    const summaryOut = await runKairosCommand(
      `build-summary ${projectDir} questions-build`,
    )
    expect(summaryOut).toContain('answered questions: 1/4')

    await runKairosCommand(`build-select ${projectDir} questions-build TB-1`)
    const nextOut = await runKairosCommand(
      `build-next ${projectDir} questions-build`,
    )
    expect(nextOut).toContain('Clarifying questions answered: 1/4')
    expect(nextOut).toContain('1. Who are the exact user roles and approvers?')
    expect(nextOut).toContain('   answer: employee manager and HR approver')
  })

  test('build-redact-answer tombstones a persisted clarifying answer without breaking the audit chain', async () => {
    const projectDir = makeProjectDir()
    const buildId = 'redact-answer-build'
    __setKairosBuildDepsForTesting({
      generateBuildId: () => buildId,
      now: () => new Date('2026-04-25T19:12:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(
      `build-answer ${projectDir} ${buildId} 2 ssn 123-45-6789`,
    )
    const eventsPath = getProjectKairosBuildEventsPath(projectDir, buildId)
    expect(
      readFileSync(
        getProjectKairosBuildManifestPath(projectDir, buildId),
        'utf8',
      ),
    ).toContain('ssn 123-45-6789')
    expect(readFileSync(eventsPath, 'utf8')).not.toContain('ssn 123-45-6789')

    const out = await runKairosCommand(
      `build-redact-answer ${projectDir} ${buildId} 2`,
    )

    expect(out.split('\n')).toEqual([
      'Redacted answer for question 2 in redact-answer-build.',
      `audit command: /kairos build-audit-verify ${projectDir} ${buildId}`,
      `events command: /kairos build-events ${projectDir} ${buildId} --kind clarifying_question_answer_redacted`,
    ])
    const questionsOut = await runKairosCommand(
      `build-questions ${projectDir} ${buildId}`,
    )
    expect(questionsOut).toContain(
      '2. What fields are required, optional, or sensitive?',
    )
    expect(questionsOut).toContain('   answer: [redacted]')
    expect(questionsOut).not.toContain('ssn 123-45-6789')
    expect(readFileSync(eventsPath, 'utf8')).not.toContain('ssn 123-45-6789')
    expect(
      await runKairosCommand(`build-audit-verify ${projectDir} ${buildId}`),
    ).toContain('Build audit chain valid for redact-answer-build.')
    expect(
      await runKairosCommand(
        `build-events ${projectDir} ${buildId} --kind clarifying_question_answer_redacted`,
      ),
    ).toContain('clarifying_question_answer_redacted question=2')
  })

  test('build-redact-answer is idempotent for an already redacted answer', async () => {
    const projectDir = makeProjectDir()
    const buildId = 'idempotent-redact-build'
    __setKairosBuildDepsForTesting({
      generateBuildId: () => buildId,
      now: () => new Date('2026-04-25T19:13:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(
      `build-answer ${projectDir} ${buildId} 2 ssn 123-45-6789`,
    )
    await runKairosCommand(`build-redact-answer ${projectDir} ${buildId} 2`)
    const eventsPath = getProjectKairosBuildEventsPath(projectDir, buildId)
    const eventCountAfterFirstRedaction = readFileSync(eventsPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean).length

    const out = await runKairosCommand(
      `build-redact-answer ${projectDir} ${buildId} 2`,
    )

    expect(out.split('\n')).toEqual([
      'Answer for question 2 in idempotent-redact-build is already redacted.',
      `audit command: /kairos build-audit-verify ${projectDir} ${buildId}`,
      `events command: /kairos build-events ${projectDir} ${buildId} --kind clarifying_question_answer_redacted`,
    ])
    expect(
      readFileSync(eventsPath, 'utf8').split(/\r?\n/).filter(Boolean),
    ).toHaveLength(eventCountAfterFirstRedaction)
    expect(
      await runKairosCommand(`build-audit-verify ${projectDir} ${buildId}`),
    ).toContain('Build audit chain valid for idempotent-redact-build.')
  })

  test('build-erasure-report summarizes answer tombstones without exposing raw answers', async () => {
    const projectDir = makeProjectDir()
    const buildId = 'erasure-report-build'
    __setKairosBuildDepsForTesting({
      generateBuildId: () => buildId,
      now: () => new Date('2026-04-25T19:16:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} erasure report`)
    await runKairosCommand(
      `build-answer ${projectDir} ${buildId} 1 employee manager and HR approver`,
    )
    await runKairosCommand(
      `build-answer ${projectDir} ${buildId} 2 dates reason and sensitive notes`,
    )
    await runKairosCommand(`build-redact-answer ${projectDir} ${buildId} 2`)

    const out = await runKairosCommand(
      `build-erasure-report ${projectDir} ${buildId}`,
    )

    expect(out).not.toContain('dates reason and sensitive notes')
    expect(out.split('\n')).toEqual([
      'Erasure report for erasure-report-build:',
      'clarifying answers: 2 answered, 1 redacted, 1 erasable',
      'redaction events: 1',
      '- question 1: answered',
      '- question 2: redacted event=yes',
      '- question 3: unanswered',
      '- question 4: unanswered',
      `redact command: /kairos build-redact-answer ${projectDir} ${buildId} <questionNumber>`,
      `audit command: /kairos build-audit-verify ${projectDir} ${buildId}`,
    ])
  })

  test('build-answer reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-answer ${projectDir} missing-build 1 answer`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-answer explains the valid clarifying question range', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'questions-build',
      now: () => new Date('2026-04-25T21:01:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-answer ${projectDir} questions-build 9 outside range`,
    )
    expect(out).toBe(
      `No clarifying question 9 found for questions-build. Valid question numbers are 1-4. Run \`/kairos build-questions ${projectDir} questions-build\` to inspect them.`,
    )
  })

  test('build-answer points fully answered builds at readiness', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'questions-build',
      now: () => new Date('2026-04-25T21:03:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    for (const [questionNumber, answer] of [
      [1, 'employee manager and HR approver'],
      [2, 'dates reason and sensitive notes'],
      [3, 'email notifications only'],
    ] as const) {
      await runKairosCommand(
        `build-answer ${projectDir} questions-build ${questionNumber} ${answer}`,
      )
    }

    const out = await runKairosCommand(
      `build-answer ${projectDir} questions-build 4 retain records for seven years`,
    )
    expect(out.split('\n')).toEqual([
      'Answered question 4 for questions-build: retain records for seven years',
      'unanswered clarifying questions remaining: 0',
      `next command: /kairos build-readiness ${projectDir} questions-build`,
    ])
  })

  test('build-unanswered lists only unanswered clarifying questions', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'questions-build',
      now: () => new Date('2026-04-25T19:12:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(
      `build-answer ${projectDir} questions-build 1 employee manager and HR approver`,
    )

    const out = await runKairosCommand(
      `build-unanswered ${projectDir} questions-build`,
    )
    expect(out.split('\n')).toEqual([
      'Unanswered clarifying questions for questions-build:',
      '2. What fields are required, optional, or sensitive?',
      '3. What notifications or integrations are required?',
      '4. What retention, export, or compliance constraints apply?',
      `next command: /kairos build-answer ${projectDir} questions-build 2 <answer>`,
    ])
  })

  test('build-unanswered reports when every clarifying question is answered', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'questions-build',
      now: () => new Date('2026-04-25T19:13:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    for (const [questionNumber, answer] of [
      [1, 'employee manager and HR approver'],
      [2, 'dates reason and sensitive notes'],
      [3, 'email notifications only'],
      [4, 'retain records for seven years'],
    ] as const) {
      await runKairosCommand(
        `build-answer ${projectDir} questions-build ${questionNumber} ${answer}`,
      )
    }

    const out = await runKairosCommand(
      `build-unanswered ${projectDir} questions-build`,
    )
    expect(out.split('\n')).toEqual([
      'No unanswered clarifying questions for questions-build.',
      `next command: /kairos build-readiness ${projectDir} questions-build`,
    ])
  })

  test('build-unanswered reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-unanswered ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-questions reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-questions ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-requirements prints persisted functional requirements', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'requirements-build',
      now: () => new Date('2026-04-25T19:15:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-requirements ${projectDir} requirements-build`,
    )
    expect(out.split('\n')).toEqual([
      'Functional requirements for requirements-build:',
      '- Intake form or record creation flow.',
      '- List/detail views for submitted records.',
      '- Role-aware approval or status workflow where applicable.',
      '- Audit trail for important state changes.',
      `outline command: /kairos build-prd-outline ${projectDir} requirements-build`,
      `readiness command: /kairos build-readiness ${projectDir} requirements-build`,
    ])
  })

  test('build-requirements reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-requirements ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-goals prints persisted draft goals', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'goals-build',
      now: () => new Date('2026-04-25T19:17:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-goals ${projectDir} goals-build`,
    )
    expect(out.split('\n')).toEqual([
      'Goals for goals-build:',
      '- Convert the brief into a buildable internal workflow app.',
      '- Preserve spec clauses as future eval and audit anchors.',
      '- Identify missing compliance, data, and approval requirements before build.',
      `outline command: /kairos build-prd-outline ${projectDir} goals-build`,
      `readiness command: /kairos build-readiness ${projectDir} goals-build`,
    ])
  })

  test('build-goals reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-goals ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-non-goals prints persisted draft non-goals', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'non-goals-build',
      now: () => new Date('2026-04-25T19:18:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-non-goals ${projectDir} non-goals-build`,
    )
    expect(out.split('\n')).toEqual([
      'Non-goals for non-goals-build:',
      '- Native mobile application.',
      '- Broad "any app" generation beyond the selected workflow.',
      `outline command: /kairos build-prd-outline ${projectDir} non-goals-build`,
      `readiness command: /kairos build-readiness ${projectDir} non-goals-build`,
    ])
  })

  test('build-non-goals reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-non-goals ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-users prints persisted draft users', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'users-build',
      now: () => new Date('2026-04-25T19:19:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-users ${projectDir} users-build`,
    )
    expect(out.split('\n')).toEqual([
      'Users for users-build:',
      '- Primary operator',
      '- Reviewer or approver',
      '- Administrator',
      `outline command: /kairos build-prd-outline ${projectDir} users-build`,
      `readiness command: /kairos build-readiness ${projectDir} users-build`,
    ])
  })

  test('build-users reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-users ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-problem prints persisted draft problem statement', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'problem-build',
      now: () => new Date('2026-04-25T19:21:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-problem ${projectDir} problem-build`,
    )
    expect(out.split('\n')).toEqual([
      'Problem for problem-build:',
      'Capture the business problem, affected users, and current workflow pain.',
      `outline command: /kairos build-prd-outline ${projectDir} problem-build`,
      `readiness command: /kairos build-readiness ${projectDir} problem-build`,
    ])
  })

  test('build-problem reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-problem ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-traceability prints persisted draft traceability seeds', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'traceability-build',
      now: () => new Date('2026-04-25T19:22:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-traceability ${projectDir} traceability-build`,
    )
    expect(out.split('\n')).toEqual([
      'Traceability seeds for traceability-build:',
      '- BRIEF-1 [brief] leave request app',
      `outline command: /kairos build-prd-outline ${projectDir} traceability-build`,
      `readiness command: /kairos build-readiness ${projectDir} traceability-build`,
    ])
  })

  test('build-traceability reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-traceability ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-summary prints compact PRD metadata counts', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'summary-build',
      now: () => new Date('2026-04-25T19:20:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(`build-select ${projectDir} summary-build TB-1`)

    const out = await runKairosCommand(
      `build-summary ${projectDir} summary-build`,
    )
    const lines = out.split('\n')
    expect(lines.slice(0, -5)).toEqual([
      'Build summary for summary-build:',
      'title: Leave Request App',
      'status: draft',
      'selected slice: TB-1',
      'problem: yes',
      'users: 3',
      'goals: 3',
      'non-goals: 2',
      'functional requirements: 4',
      'acceptance checks: 4',
      'clarifying questions: 4',
      'answered questions: 0/4',
      'erasure: 0 redacted, 0 erasable',
      'assumptions: 4',
      'risks: 4',
      'tracer slices: 3',
      'completed slices: 0',
      'traceability seeds: 1',
    ])
    expect(lines.at(-5)?.startsWith('last event: slice_selected at ')).toBe(
      true,
    )
    expect(lines.at(-4)).toMatch(
      /^audit: valid events=3 last=[a-f0-9]{64}$/,
    )
    expect(lines.at(-3)).toBe(
      `progress command: /kairos build-progress ${projectDir} summary-build`,
    )
    expect(lines.at(-2)).toBe(
      `readiness command: /kairos build-readiness ${projectDir} summary-build`,
    )
    expect(lines.at(-1)).toBe('brief: leave request app')
  })

  test('build-summary reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-summary ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-progress prints selected, completed, and pending tracer bullets', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'progress-build',
      now: () => new Date('2026-04-25T19:52:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(`build-select ${projectDir} progress-build TB-1`)
    await runKairosCommand(
      `build-complete-slice ${projectDir} progress-build`,
    )
    await runKairosCommand(`build-select ${projectDir} progress-build TB-2`)

    const out = await runKairosCommand(
      `build-progress ${projectDir} progress-build`,
    )
    expect(out.split('\n')).toEqual([
      'Build progress for progress-build:',
      'readiness: blocked',
      'selected slice: TB-2',
      'completed slices: 1/3',
      'remaining slices: 2',
      'next slice: TB-2 Review workflow path',
      `next command: /kairos build-next ${projectDir} progress-build`,
      `readiness command: /kairos build-readiness ${projectDir} progress-build`,
      '- TB-1 Record intake skeleton [complete]',
      '- TB-2 Review workflow path [selected]',
      '- TB-3 Validation and role guardrails [pending]',
    ])
  })

  test('build-progress points unselected builds at select-next-prompt', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'progress-build',
      now: () => new Date('2026-04-25T20:59:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-progress ${projectDir} progress-build`,
    )
    expect(out.split('\n')).toEqual([
      'Build progress for progress-build:',
      'readiness: blocked',
      'selected slice: —',
      'completed slices: 0/3',
      'remaining slices: 3',
      'next slice: TB-1 Record intake skeleton',
      `next command: /kairos build-select-next-prompt ${projectDir} progress-build`,
      `readiness command: /kairos build-readiness ${projectDir} progress-build`,
      '- TB-1 Record intake skeleton [pending]',
      '- TB-2 Review workflow path [pending]',
      '- TB-3 Validation and role guardrails [pending]',
    ])
  })

  test('build-progress reports no next slice when all tracer bullets are complete', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'progress-build',
      now: () => new Date('2026-04-25T19:58:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    for (const sliceId of ['TB-1', 'TB-2', 'TB-3']) {
      await runKairosCommand(
        `build-select ${projectDir} progress-build ${sliceId}`,
      )
      await runKairosCommand(
        `build-complete-slice ${projectDir} progress-build`,
      )
    }

    const out = await runKairosCommand(
      `build-progress ${projectDir} progress-build`,
    )
    expect(out).toContain('completed slices: 3/3')
    expect(out).toContain('remaining slices: 0')
    expect(out).toContain('readiness: blocked')
    expect(out).toContain('next slice: —')
    expect(out).toContain('next command: —')
    expect(out).toContain(
      `readiness command: /kairos build-readiness ${projectDir} progress-build`,
    )
  })

  test('build-progress reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-progress ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-progress reports its own usage for missing args', async () => {
    const out = await runKairosCommand('build-progress')
    expect(out).toBe('Usage: /kairos build-progress [projectDir] <buildId>')
  })

  test('build-readiness summarizes selected slice and question blockers', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'readiness-build',
      now: () => new Date('2026-04-25T20:48:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(
      `build-answer ${projectDir} readiness-build 1 employee manager and HR approver`,
    )
    await runKairosCommand(`build-select ${projectDir} readiness-build TB-1`)

    const out = await runKairosCommand(
      `build-readiness ${projectDir} readiness-build`,
    )
    const lines = out.split('\n')
    expect(lines.slice(0, 6)).toEqual([
      'Build readiness for readiness-build:',
      'readiness: blocked',
      'selected slice: TB-1 Record intake skeleton',
      'completed slices: 0/3',
      'clarifying questions answered: 1/4',
      'unanswered clarifying questions: 3',
    ])
    expect(lines[6]?.startsWith('last event: slice_selected at ')).toBe(true)
    expect(lines[7]).toMatch(/^audit: valid events=4 last=[a-f0-9]{64}$/)
    expect(lines.slice(8)).toEqual([
      'next command: /kairos build-next ' + projectDir + ' readiness-build',
      'questions command: /kairos build-unanswered ' +
        projectDir +
        ' readiness-build',
      'blockers:',
      '- 2. What fields are required, optional, or sensitive?',
      '- 3. What notifications or integrations are required?',
      '- 4. What retention, export, or compliance constraints apply?',
    ])
  })

  test('build-readiness points unselected builds at select-next-prompt', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'readiness-build',
      now: () => new Date('2026-04-25T20:55:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-readiness ${projectDir} readiness-build`,
    )
    const lines = out.split('\n')
    expect(lines.slice(0, 6)).toEqual([
      'Build readiness for readiness-build:',
      'readiness: blocked',
      'selected slice: —',
      'completed slices: 0/3',
      'clarifying questions answered: 0/4',
      'unanswered clarifying questions: 4',
    ])
    expect(lines[6]?.startsWith('last event: spec_written at ')).toBe(true)
    expect(lines[7]).toMatch(/^audit: valid events=2 last=[a-f0-9]{64}$/)
    expect(lines.slice(8)).toEqual([
      'next command: /kairos build-select-next-prompt ' +
        projectDir +
        ' readiness-build',
      'questions command: /kairos build-unanswered ' +
        projectDir +
        ' readiness-build',
      'blockers:',
      '- Select an incomplete tracer slice before running build-next.',
      '- 1. Who are the exact user roles and approvers?',
      '- 2. What fields are required, optional, or sensitive?',
      '- 3. What notifications or integrations are required?',
      '- 4. What retention, export, or compliance constraints apply?',
    ])
  })

  test('build-readiness reports ready when every question and slice is complete', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'readiness-build',
      now: () => new Date('2026-04-25T20:49:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    for (const [questionNumber, answer] of [
      [1, 'employee manager and HR approver'],
      [2, 'dates reason and sensitive notes'],
      [3, 'email notifications only'],
      [4, 'retain records for seven years'],
    ] as const) {
      await runKairosCommand(
        `build-answer ${projectDir} readiness-build ${questionNumber} ${answer}`,
      )
    }
    for (const sliceId of ['TB-1', 'TB-2', 'TB-3']) {
      await runKairosCommand(
        `build-select ${projectDir} readiness-build ${sliceId}`,
      )
      await runKairosCommand(
        `build-complete-slice ${projectDir} readiness-build`,
      )
    }

    const out = await runKairosCommand(
      `build-readiness ${projectDir} readiness-build`,
    )
    const lines = out.split('\n')
    expect(lines.slice(0, 6)).toEqual([
      'Build readiness for readiness-build:',
      'readiness: ready',
      'selected slice: TB-3 Validation and role guardrails',
      'completed slices: 3/3',
      'clarifying questions answered: 4/4',
      'unanswered clarifying questions: 0',
    ])
    expect(lines[6]?.startsWith('last event: slice_completed at ')).toBe(true)
    expect(lines[7]).toMatch(/^audit: valid events=12 last=[a-f0-9]{64}$/)
    expect(lines.slice(8)).toEqual([
      'next command: —',
      'blockers: none',
    ])
  })

  test('build-readiness blocks when the audit chain is invalid', async () => {
    const projectDir = makeProjectDir()
    const zeroHash =
      '0000000000000000000000000000000000000000000000000000000000000000'
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'readiness-audit-build',
      now: () => new Date('2026-04-25T20:50:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    for (const [questionNumber, answer] of [
      [1, 'employee manager and HR approver'],
      [2, 'dates reason and sensitive notes'],
      [3, 'email notifications only'],
      [4, 'retain records for seven years'],
    ] as const) {
      await runKairosCommand(
        `build-answer ${projectDir} readiness-audit-build ${questionNumber} ${answer}`,
      )
    }
    for (const sliceId of ['TB-1', 'TB-2', 'TB-3']) {
      await runKairosCommand(
        `build-select ${projectDir} readiness-audit-build ${sliceId}`,
      )
      await runKairosCommand(
        `build-complete-slice ${projectDir} readiness-audit-build`,
      )
    }
    const eventsPath = getProjectKairosBuildEventsPath(
      projectDir,
      'readiness-audit-build',
    )
    writeFileSync(
      eventsPath,
      readFileSync(eventsPath, 'utf8').replace(
        /"auditHash":"[a-f0-9]{64}"/,
        `"auditHash":"${zeroHash}"`,
      ),
      'utf8',
    )

    const out = await runKairosCommand(
      `build-readiness ${projectDir} readiness-audit-build`,
    )
    const lines = out.split('\n')
    expect(lines.slice(0, 6)).toEqual([
      'Build readiness for readiness-audit-build:',
      'readiness: blocked',
      'selected slice: TB-3 Validation and role guardrails',
      'completed slices: 3/3',
      'clarifying questions answered: 4/4',
      'unanswered clarifying questions: 0',
    ])
    expect(lines[6]?.startsWith('last event: slice_completed at ')).toBe(true)
    expect(lines.slice(7)).toEqual([
      'audit: invalid event=1 reason=hash mismatch',
      'next command: —',
      'blockers:',
      '- Build audit chain is invalid at event 1: hash mismatch.',
    ])
  })

  test('build-readiness blocks when a filesystem audit anchor is invalid', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'readiness-anchor-build',
      now: () => new Date('2026-04-25T20:48:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} anchor readiness`)
    await runKairosCommand(
      `build-audit-anchor ${projectDir} readiness-anchor-build`,
    )
    const anchorPath = getProjectKairosBuildAuditAnchorPath(
      projectDir,
      'readiness-anchor-build',
    )
    const anchor = readJson(anchorPath)
    writeFileSync(
      anchorPath,
      JSON.stringify({ ...anchor, anchorHash: '0'.repeat(64) }),
    )

    const out = await runKairosCommand(
      `build-readiness ${projectDir} readiness-anchor-build`,
    )

    expect(out).toContain('anchor: invalid reason=anchor hash mismatch')
    expect(out).toContain(
      '- Build audit anchor is invalid: anchor hash mismatch.',
    )
  })

  test('build-readiness blocks when a redacted answer has no redaction audit event', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'readiness-erasure-build',
      now: () => new Date('2026-04-25T20:48:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} erasure readiness`)
    await runKairosCommand(
      `build-answer ${projectDir} readiness-erasure-build 2 sensitive answer`,
    )
    const manifestPath = getProjectKairosBuildManifestPath(
      projectDir,
      'readiness-erasure-build',
    )
    const manifest = readJson(manifestPath)
    writeFileSync(
      manifestPath,
      JSON.stringify({
        ...manifest,
        clarifyingQuestionAnswers: {
          ...((manifest as { clarifyingQuestionAnswers?: object })
            .clarifyingQuestionAnswers ?? {}),
          2: '[redacted]',
        },
      }),
    )

    const out = await runKairosCommand(
      `build-readiness ${projectDir} readiness-erasure-build`,
    )

    expect(out).toContain(
      'erasure: invalid reason=redacted answer missing redaction event',
    )
    expect(out).toContain(
      '- Build erasure evidence is invalid: redacted answer missing redaction event.',
    )
  })

  test('build-readiness reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-readiness ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-prd-outline prints persisted PRD sections in canonical order', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'outline-build',
      now: () => new Date('2026-04-25T19:24:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-prd-outline ${projectDir} outline-build`,
    )
    expect(out.split('\n')).toEqual([
      'PRD outline for outline-build:',
      'title: Leave Request App',
      'problem: Capture the business problem, affected users, and current workflow pain.',
      'users:',
      '- Primary operator',
      '- Reviewer or approver',
      '- Administrator',
      'goals:',
      '- Convert the brief into a buildable internal workflow app.',
      '- Preserve spec clauses as future eval and audit anchors.',
      '- Identify missing compliance, data, and approval requirements before build.',
      'non-goals:',
      '- Native mobile application.',
      '- Broad "any app" generation beyond the selected workflow.',
      'functional requirements:',
      '- Intake form or record creation flow.',
      '- List/detail views for submitted records.',
      '- Role-aware approval or status workflow where applicable.',
      '- Audit trail for important state changes.',
      'acceptance checks:',
      '- A user can create a valid record from the primary form.',
      '- A reviewer can find and act on pending records.',
      '- Invalid or incomplete data is rejected with clear feedback.',
      '- Important changes are visible in an audit trail.',
      'assumptions:',
      '- The first build targets a browser-based internal workflow tool.',
      '- A human reviewer will confirm roles, fields, and compliance constraints before implementation.',
      '- Local single-tenant state is acceptable until deployment requirements are known.',
      '- Auditability is required for approval or status changes.',
      'risks:',
      '- Unknown data fields can cause rework in the first implementation slice.',
      '- Unconfirmed approver roles can weaken workflow and permission tests.',
      '- Missing integration expectations can hide notification or export work.',
      '- Compliance requirements may change storage, audit, and retention design.',
      'clarifying questions:',
      '1. Who are the exact user roles and approvers?',
      '2. What fields are required, optional, or sensitive?',
      '3. What notifications or integrations are required?',
      '4. What retention, export, or compliance constraints apply?',
      'traceability seeds:',
      '- BRIEF-1 [brief] leave request app',
      `show command: /kairos build-show ${projectDir} outline-build`,
      `readiness command: /kairos build-readiness ${projectDir} outline-build`,
    ])
  })

  test('build-prd-outline reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-prd-outline ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-assumptions prints persisted draft assumptions', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'assumptions-build',
      now: () => new Date('2026-04-25T19:25:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-assumptions ${projectDir} assumptions-build`,
    )
    expect(out.split('\n')).toEqual([
      'Assumptions for assumptions-build:',
      '- The first build targets a browser-based internal workflow tool.',
      '- A human reviewer will confirm roles, fields, and compliance constraints before implementation.',
      '- Local single-tenant state is acceptable until deployment requirements are known.',
      '- Auditability is required for approval or status changes.',
      `outline command: /kairos build-prd-outline ${projectDir} assumptions-build`,
      `readiness command: /kairos build-readiness ${projectDir} assumptions-build`,
    ])
  })

  test('build-assumptions reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-assumptions ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-risks prints persisted draft risks', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'risks-build',
      now: () => new Date('2026-04-25T19:30:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-risks ${projectDir} risks-build`,
    )
    expect(out.split('\n')).toEqual([
      'Risks for risks-build:',
      '- Unknown data fields can cause rework in the first implementation slice.',
      '- Unconfirmed approver roles can weaken workflow and permission tests.',
      '- Missing integration expectations can hide notification or export work.',
      '- Compliance requirements may change storage, audit, and retention design.',
      `outline command: /kairos build-prd-outline ${projectDir} risks-build`,
      `readiness command: /kairos build-readiness ${projectDir} risks-build`,
    ])
  })

  test('build-risks reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-risks ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-select persists the selected tracer bullet', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'select-build',
      now: () => new Date('2026-04-25T18:55:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(`build-select ${projectDir} select-build TB-2`)
    expect(out.split('\n')).toEqual([
      'Selected TB-2 for select-build: Review workflow path',
      'test: a pending record can move to approved or rejected with an audit entry',
      'implement: add status transitions, reviewer action controls, and audit recording',
      `next command: /kairos build-next ${projectDir} select-build`,
      `progress command: /kairos build-progress ${projectDir} select-build`,
    ])
    expect(readJson(getProjectKairosBuildManifestPath(projectDir, 'select-build'))).toMatchObject({
      selectedSliceId: 'TB-2',
      status: 'draft',
    })
    expect(readFileSync(getProjectKairosBuildEventsPath(projectDir, 'select-build'), 'utf8')).toContain(
      '"kind":"slice_selected"',
    )
    const eventsOut = await runKairosCommand(`build-events ${projectDir} select-build`)
    expect(eventsOut).toContain(
      'slice_selected slice=TB-2 title=Review workflow path',
    )
  })

  test('build-select reports an unknown slice clearly', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'select-build',
      now: () => new Date('2026-04-25T18:55:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(`build-select ${projectDir} select-build TB-9`)
    expect(out.split('\n')).toEqual([
      'No tracer slice TB-9 found for select-build.',
      `slices command: /kairos build-slices ${projectDir} select-build`,
    ])
  })

  test('build-select reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-select ${projectDir} missing-build TB-1`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-select-next selects the first tracer bullet when none is selected', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'select-next-build',
      now: () => new Date('2026-04-25T19:32:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-select-next ${projectDir} select-next-build`,
    )
    expect(out.split('\n')).toEqual([
      'Selected TB-1 for select-next-build: Record intake skeleton',
      'test: creating the minimum valid record persists it and shows it in a list',
      'implement: add the smallest form, persistence path, and list view needed for one record',
      `next command: /kairos build-next ${projectDir} select-next-build`,
      `progress command: /kairos build-progress ${projectDir} select-next-build`,
    ])
    expect(readJson(getProjectKairosBuildManifestPath(projectDir, 'select-next-build'))).toMatchObject({
      selectedSliceId: 'TB-1',
    })
  })

  test('build-select-next advances from the selected tracer bullet', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'select-next-build',
      now: () => new Date('2026-04-25T19:34:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(`build-select ${projectDir} select-next-build TB-1`)

    const out = await runKairosCommand(
      `build-select-next ${projectDir} select-next-build`,
    )
    expect(out).toContain(
      'Selected TB-2 for select-next-build: Review workflow path',
    )
    expect(readJson(getProjectKairosBuildManifestPath(projectDir, 'select-next-build'))).toMatchObject({
      selectedSliceId: 'TB-2',
    })
  })

  test('build-select-next skips completed tracer bullets', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'select-next-build',
      now: () => new Date('2026-04-25T19:48:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(`build-select ${projectDir} select-next-build TB-1`)
    await runKairosCommand(
      `build-complete-slice ${projectDir} select-next-build`,
    )
    await runKairosCommand(`build-select ${projectDir} select-next-build TB-2`)
    await runKairosCommand(
      `build-complete-slice ${projectDir} select-next-build`,
    )
    await runKairosCommand(`build-select ${projectDir} select-next-build TB-1`)

    const out = await runKairosCommand(
      `build-select-next ${projectDir} select-next-build`,
    )
    expect(out).toContain(
      'Selected TB-3 for select-next-build: Validation and role guardrails',
    )
    expect(readJson(getProjectKairosBuildManifestPath(projectDir, 'select-next-build'))).toMatchObject(
      {
        selectedSliceId: 'TB-3',
        completedSliceIds: ['TB-1', 'TB-2'],
      },
    )
  })

  test('build-select-next points the last selected tracer bullet at build-next', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'last-selected-build',
      now: () => new Date('2026-04-25T19:49:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(`build-select ${projectDir} last-selected-build TB-3`)

    const out = await runKairosCommand(
      `build-select-next ${projectDir} last-selected-build`,
    )
    expect(out.split('\n')).toEqual([
      'No next tracer slice found after TB-3 for last-selected-build.',
      `next command: /kairos build-next ${projectDir} last-selected-build`,
      `progress command: /kairos build-progress ${projectDir} last-selected-build`,
    ])
  })

  test('build-select-next reports when no incomplete tracer bullet remains', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'all-complete-build',
      now: () => new Date('2026-04-25T19:50:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    for (const sliceId of ['TB-1', 'TB-2', 'TB-3']) {
      await runKairosCommand(
        `build-select ${projectDir} all-complete-build ${sliceId}`,
      )
      await runKairosCommand(
        `build-complete-slice ${projectDir} all-complete-build`,
      )
    }

    const out = await runKairosCommand(
      `build-select-next ${projectDir} all-complete-build`,
    )
    expect(out.split('\n')).toEqual([
      'No incomplete tracer slice found after TB-3 for all-complete-build.',
      `progress command: /kairos build-progress ${projectDir} all-complete-build`,
      `readiness command: /kairos build-readiness ${projectDir} all-complete-build`,
    ])
  })

  test('build-select-next reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-select-next ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-select-next-prompt selects and renders the next TDD prompt', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'select-next-prompt-build',
      now: () => new Date('2026-04-25T19:38:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-select-next-prompt ${projectDir} select-next-prompt-build`,
    )
    expect(out).toContain(
      'Build next slice: TB-1 Record intake skeleton',
    )
    expect(out).toContain('Write the failing test first:')
    expect(out).toContain('PRD anchors:')
    expect(out).toContain('Stress-test before coding:')
    expect(readJson(getProjectKairosBuildManifestPath(projectDir, 'select-next-prompt-build'))).toMatchObject({
      selectedSliceId: 'TB-1',
    })

    const eventsOut = await runKairosCommand(
      `build-events ${projectDir} select-next-prompt-build`,
    )
    expect(eventsOut).toContain(
      'slice_selected slice=TB-1 title=Record intake skeleton',
    )
    expect(eventsOut).toContain(
      'next_slice_prompt_rendered slice=TB-1 title=Record intake skeleton',
    )
  })

  test('build-select-next-prompt reports its own usage for missing args', async () => {
    const out = await runKairosCommand('build-select-next-prompt')
    expect(out).toBe(
      'Usage: /kairos build-select-next-prompt [projectDir] <buildId>',
    )
  })

  test('build-complete-slice records the selected tracer bullet as completed', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'complete-build',
      now: () => new Date('2026-04-25T19:42:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(`build-select ${projectDir} complete-build TB-1`)

    const out = await runKairosCommand(
      `build-complete-slice ${projectDir} complete-build`,
    )
    expect(out.split('\n')).toEqual([
      'Completed TB-1 for complete-build: Record intake skeleton',
      `progress command: /kairos build-progress ${projectDir} complete-build`,
      `readiness command: /kairos build-readiness ${projectDir} complete-build`,
      `next command: /kairos build-select-next-prompt ${projectDir} complete-build`,
    ])
    expect(readJson(getProjectKairosBuildManifestPath(projectDir, 'complete-build'))).toMatchObject({
      selectedSliceId: 'TB-1',
      completedSliceIds: ['TB-1'],
    })

    const eventsOut = await runKairosCommand(
      `build-events ${projectDir} complete-build`,
    )
    expect(eventsOut).toContain(
      'slice_completed slice=TB-1 title=Record intake skeleton',
    )
  })

  test('build-complete-slice is idempotent for an already completed tracer bullet', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'complete-build',
      now: () => new Date('2026-04-25T19:56:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(`build-select ${projectDir} complete-build TB-1`)
    await runKairosCommand(`build-complete-slice ${projectDir} complete-build`)

    const out = await runKairosCommand(
      `build-complete-slice ${projectDir} complete-build`,
    )
    expect(out.split('\n')).toEqual([
      'Tracer slice TB-1 is already complete for complete-build: Record intake skeleton',
      `progress command: /kairos build-progress ${projectDir} complete-build`,
      `readiness command: /kairos build-readiness ${projectDir} complete-build`,
    ])

    const eventsOut = await runKairosCommand(
      `build-events ${projectDir} complete-build`,
    )
    expect(eventsOut.match(/slice_completed slice=TB-1/g)).toHaveLength(1)
  })

  test('build-complete-slice requires a selected tracer bullet', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'complete-build',
      now: () => new Date('2026-04-25T19:44:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(
      `build-complete-slice ${projectDir} complete-build`,
    )
    expect(out).toBe(
      `No tracer slice selected for complete-build. Run \`/kairos build-select ${projectDir} complete-build <sliceId>\` first.`,
    )
  })

  test('build-complete-slice reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-complete-slice ${projectDir} missing-build`,
    )
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-complete-slice reports its own usage for missing args', async () => {
    const out = await runKairosCommand('build-complete-slice')
    expect(out).toBe(
      'Usage: /kairos build-complete-slice [projectDir] <buildId>',
    )
  })

  test('build-next renders a TDD prompt for the selected tracer bullet', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'next-build',
      now: () => new Date('2026-04-25T19:00:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(`build-select ${projectDir} next-build TB-1`)

    const out = await runKairosCommand(`build-next ${projectDir} next-build`)
    expect(out).toContain('Build next slice: TB-1 Record intake skeleton')
    expect(out).toContain(`Project: ${projectDir}`)
    expect(out).toContain('Write the failing test first:')
    expect(out).toContain(
      'creating the minimum valid record persists it and shows it in a list',
    )
    expect(out).toContain('Required TDD loop:')
    expect(out).toContain(
      '1. Add or update the narrow failing test for this slice.',
    )
    expect(out).toContain(
      '2. Run that focused test and confirm it fails for the expected reason.',
    )
    expect(out).toContain('3. Implement only this slice.')
    expect(out).toContain(
      "4. Re-run the focused test, then the repo's standard verification.",
    )
    expect(out).toContain(
      '5. Commit the passing slice before marking it complete.',
    )
    expect(out).toContain('PRD anchors:')
    expect(out).toContain('functional requirements:')
    expect(out).toContain('- Intake form or record creation flow.')
    expect(out).toContain('acceptance checks:')
    expect(out).toContain(
      '- A user can create a valid record from the primary form.',
    )
    expect(out).toContain('traceability seeds:')
    expect(out).toContain('- BRIEF-1 [brief] leave request app')
    expect(out).toContain('Stress-test before coding:')
    expect(out).toContain('Clarifying questions answered: 0/4')
    expect(out).toContain('Unanswered clarifying questions: 4')
    expect(out).toContain('unanswered clarifying questions:')
    expect(out).toContain('2. What fields are required, optional, or sensitive?')
    expect(out).toContain('assumptions:')
    expect(out).toContain(
      '- The first build targets a browser-based internal workflow tool.',
    )
    expect(out).toContain('risks:')
    expect(out).toContain(
      '- Unknown data fields can cause rework in the first implementation slice.',
    )
    expect(out).toContain('clarifying questions:')
    expect(out).toContain('1. Who are the exact user roles and approvers?')
    expect(out).toContain('Then implement only this slice:')
    expect(out).toContain(
      'add the smallest form, persistence path, and list view needed for one record',
    )
    expect(out).toContain('Run verification before committing.')
    expect(out).toContain(
      `After the commit, mark this slice complete with \`/kairos build-complete-slice ${projectDir} next-build\`.`,
    )
    expect(out).toContain(
      `Track progress with \`/kairos build-progress ${projectDir} next-build\`.`,
    )
    expect(out).toContain(
      `Check readiness with \`/kairos build-readiness ${projectDir} next-build\`.`,
    )

    const eventsOut = await runKairosCommand(`build-events ${projectDir} next-build`)
    expect(eventsOut).toContain(
      'next_slice_prompt_rendered slice=TB-1 title=Record intake skeleton',
    )
  })

  test('build-next requires a selected tracer bullet', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'next-build',
      now: () => new Date('2026-04-25T19:00:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(`build-next ${projectDir} next-build`)
    expect(out).toBe(
      `No tracer slice selected for next-build. Run \`/kairos build-select ${projectDir} next-build <sliceId>\` first.`,
    )
  })

  test('build-next reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(`build-next ${projectDir} missing-build`)
    expect(out.split('\n')).toEqual([
      `No build missing-build found for ${projectDir}.`,
      `builds command: /kairos builds ${projectDir}`,
    ])
  })

  test('build-next refuses a completed selected tracer bullet', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'next-build',
      now: () => new Date('2026-04-25T19:54:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)
    await runKairosCommand(`build-select ${projectDir} next-build TB-1`)
    await runKairosCommand(`build-complete-slice ${projectDir} next-build`)

    const out = await runKairosCommand(`build-next ${projectDir} next-build`)
    expect(out).toBe(
      `Selected tracer slice TB-1 is already complete for next-build. Run \`/kairos build-select-next ${projectDir} next-build\` first.`,
    )
  })

  test('pause writes pause.json and resume clears it', async () => {
    const pausePath = join(
      process.env.CLAUDE_CONFIG_DIR as string,
      'kairos',
      'pause.json',
    )

    await runKairosCommand('pause')
    expect((readJson(pausePath) as { paused: boolean }).paused).toBe(true)

    await runKairosCommand('resume')
    expect((readJson(pausePath) as { paused: boolean }).paused).toBe(false)
  })

  test('resume warns the user when the prior pause was an auth_failure', async () => {
    // Users who /kairos resume without actually re-auth'ing would otherwise
    // silently loop-retry on the next tick. Make the command explicitly
    // call out the prerequisite.
    const stateDir = join(process.env.CLAUDE_CONFIG_DIR as string, 'kairos')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(
      join(stateDir, 'pause.json'),
      JSON.stringify({
        paused: true,
        reason: 'auth_failure',
        scope: 'global',
        source: 'daemon',
        setAt: '2026-04-22T12:00:00Z',
        notice: 'KAIROS daemon hit an auth failure.',
      }),
    )

    const out = await runKairosCommand('resume')
    expect(out).toContain('auth_failure')
    expect(out).toContain('`claude` interactively')
  })

  test('resume is silent on the auth warning when prior pause was not auth_failure', async () => {
    await runKairosCommand('pause')
    const out = await runKairosCommand('resume')
    expect(out).toBe('Resumed KAIROS daemon.')
  })

  test('status surfaces the daemon-authored re-auth notice verbatim', async () => {
    const stateDir = join(process.env.CLAUDE_CONFIG_DIR as string, 'kairos')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(
      join(stateDir, 'pause.json'),
      JSON.stringify({
        paused: true,
        reason: 'auth_failure',
        scope: 'global',
        source: 'daemon',
        setAt: '2026-04-22T12:00:00Z',
        notice:
          'KAIROS daemon hit an auth failure. Run `claude` interactively once to re-authorize the Keychain entry, then resume the daemon.',
      }),
    )

    const out = await runKairosCommand('status')
    expect(out).toContain('paused: yes [auth_failure]')
    expect(out).toContain('notice: KAIROS daemon hit an auth failure')
    expect(out).toContain('Run `claude` interactively')
  })

  test('status reports running daemon + pause state', async () => {
    const projectDir = makeProjectDir()
    await runKairosCommand(`opt-in ${projectDir}`)
    await seedKairosProjectState(projectDir)

    await runKairosCommand('pause')
    const out = await runKairosCommand('status')
    expect(out).toContain('pid 4242')
    expect(out).toContain('paused: yes')
    expect(out).toContain(`project: ${projectDir}`)
    expect(out).toContain('worker running: yes')
    expect(out).toContain('overlap pending: yes')
    expect(out).toContain('pending count: 2')
    expect(out).toContain('queued tasks: 1')
    expect(out).toContain('project cost: $0.1500')
    expect(out).toContain('global cost: $0.2500')
  })

  test('dashboard respects KAIROS_DASHBOARD_URL override', async () => {
    process.env.KAIROS_DASHBOARD_URL = 'http://127.0.0.1:9999/'
    const out = await runKairosCommand('dashboard')
    expect(out).toBe('Dashboard: http://127.0.0.1:9999/')
  })

  test('logs returns the daemon stdout tail', async () => {
    const stateDir = join(process.env.CLAUDE_CONFIG_DIR as string, 'kairos')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(
      join(stateDir, 'daemon.out.log'),
      ['[t] first', '[t] second', '[t] third', ''].join('\n'),
    )

    const out = await runKairosCommand('logs 2')
    expect(out).toBe(['[t] second', '[t] third'].join('\n'))
  })

  test('logs returns project log tail when a project dir is passed', async () => {
    const projectDir = makeProjectDir()
    const logPath = join(projectDir, '.claude', 'kairos', 'log.jsonl')
    mkdirSync(join(projectDir, '.claude', 'kairos'), { recursive: true })
    writeFileSync(
      logPath,
      ['{"a":1}', '{"a":2}', '{"a":3}', ''].join('\n'),
    )

    const out = await runKairosCommand(`logs ${projectDir} 2`)
    expect(out).toBe(['{"a":2}', '{"a":3}'].join('\n'))
  })

  test('logs treats a bare number as a line count, not a project dir', async () => {
    // Regression: the earlier heuristic matched any token containing `/`,
    // `~`, or `.` — so `25.` would have been routed to project logs.
    // Bare digits must always be a line count.
    const stateDir = join(process.env.CLAUDE_CONFIG_DIR as string, 'kairos')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(
      join(stateDir, 'daemon.out.log'),
      ['a', 'b', 'c', 'd', ''].join('\n'),
    )

    const out = await runKairosCommand('logs 3')
    expect(out).toBe(['b', 'c', 'd'].join('\n'))
  })

  test('cloud-sync requires an explicit runtime root', async () => {
    const out = await runKairosCommand('cloud-sync')
    expect(out).toBe('Usage: /kairos cloud-sync <runtimeRoot>')
  })

  test('cloud-sync builds and applies a bundle to the requested runtime root', async () => {
    const runtimeRoot = makeProjectDir()
    let receivedRuntimeRoot: string | null = null
    __setKairosCloudSyncDepsForTesting({
      async buildBundle() {
        return {
          version: 1,
          createdAt: '2026-04-22T12:00:00.000Z',
          files: [
            {
              relativePath: 'config/.claude/skills/demo/SKILL.md',
              sizeBytes: 4,
              sha256: 'abcd',
              contentBase64: Buffer.from('demo', 'utf8').toString('base64'),
            },
          ],
          projects: [
            {
              id: 'proj1234abcd',
              remoteUrl: 'https://github.com/example/repo.git',
              normalizedRemoteUrl: 'github.com/example/repo',
              headRef: 'main',
              headCommit: 'deadbeef',
            },
          ],
        }
      },
      async applyBundle(_bundle, options) {
        receivedRuntimeRoot = options.runtimeRoot
        return {
          sourceDir: join(options.runtimeRoot, 'source'),
          overlayDir: join(options.runtimeRoot, 'overlay'),
          manifestPath: join(options.runtimeRoot, 'source', 'manifest.json'),
          registryPath: join(
            options.runtimeRoot,
            'source',
            'registry',
            'projects.json',
          ),
          managedPaths: [
            'config/.claude/skills/demo/SKILL.md',
            'manifest.json',
            'registry/projects.json',
          ],
        }
      },
    })

    const out = await runKairosCommand(`cloud-sync ${runtimeRoot}`)
    expect(receivedRuntimeRoot).toBe(runtimeRoot)
    expect(out).toContain('Cloud sync applied: 1 file(s), 1 project(s)')
    expect(out).toContain(`runtime root: ${runtimeRoot}`)
    expect(out).toContain(join(runtimeRoot, 'source'))
    expect(out).toContain(join(runtimeRoot, 'overlay'))
  })

  test('cloud-sync surfaces build or apply failures as user-facing errors', async () => {
    __setKairosCloudSyncDepsForTesting({
      async buildBundle() {
        throw new Error('Project /tmp/missing has no reachable git remote')
      },
      async applyBundle() {
        throw new Error('unreachable')
      },
    })

    const out = await runKairosCommand('cloud-sync ./runtime-root')
    expect(out).toBe(
      'Cloud sync failed: Project /tmp/missing has no reachable git remote',
    )
  })

  test('skills export emits a self-contained manifest', async () => {
    const projectDir = makeProjectDir()
    setProjectRoot(projectDir)
    mkdirSync(join(projectDir, '.claude', 'skills', 'example'), {
      recursive: true,
    })
    writeFileSync(
      join(projectDir, '.claude', 'skills', 'example', 'SKILL.md'),
      [
        '---',
        'name: example',
        'description: Example exported skill.',
        '---',
        '',
        'Use this skill to verify command routing.',
        '',
      ].join('\n'),
    )

    const out = await runKairosCommand('skills export example')
    const parsed = JSON.parse(out) as {
      skills: Array<{ url: string }>
    }
    expect(parsed.skills[0]?.url.startsWith('data:text/markdown;base64,')).toBe(
      true,
    )
  })

  test('skills import previews first and writes on --yes', async () => {
    const sourceDir = makeProjectDir()
    mkdirSync(join(sourceDir, 'example'), { recursive: true })
    writeFileSync(
      join(sourceDir, 'example', 'SKILL.md'),
      [
        '---',
        'name: example',
        'description: Example imported skill.',
        '---',
        '',
        'Use this skill to verify import command routing.',
        '',
      ].join('\n'),
    )

    const preview = await runKairosCommand(
      `skills import ${join(sourceDir, 'example')}`,
    )
    expect(preview).toContain('Import preview')

    const confirmed = await runKairosCommand(
      `skills import ${join(sourceDir, 'example')} --yes`,
    )
    expect(confirmed).toContain('Imported skill')
  })

  test('skills import supports confirmed pasted JSON manifests', async () => {
    const projectDir = makeProjectDir()
    setProjectRoot(projectDir)
    mkdirSync(join(projectDir, '.claude', 'skills', 'example'), {
      recursive: true,
    })
    writeFileSync(
      join(projectDir, '.claude', 'skills', 'example', 'SKILL.md'),
      [
        '---',
        'name: example',
        'description: Example exported skill.',
        '---',
        '',
        'Use this skill to verify JSON blob import routing.',
        '',
      ].join('\n'),
    )

    const manifest = await runKairosCommand('skills export example')
    const confirmed = await runKairosCommand(`skills import --yes ${manifest}`)
    expect(confirmed).toContain('Imported skill')
  })

  test('memory-proposals list shows pending proposals', async () => {
    const { queueMemoryProposal } = await import(
      '../services/memory/proposalQueue.js'
    )
    queueMemoryProposal(
      {
        kind: 'fact',
        content: 'The daemon uses FTS5-backed recall.',
        evidence_session_id: 'sess-1',
      },
      { generateId: () => 'prop001' },
    )

    const out = await runKairosCommand('memory-proposals list')
    expect(out).toContain('prop001')
    expect(out).toContain('[fact]')
  })

  test('memory-proposals accept updates memory files', async () => {
    const { queueMemoryProposal } = await import(
      '../services/memory/proposalQueue.js'
    )
    queueMemoryProposal(
      {
        kind: 'preference',
        content: 'The user prefers concise recall summaries.',
        evidence_session_id: 'sess-2',
      },
      { generateId: () => 'prop002' },
    )

    const out = await runKairosCommand('memory-proposals accept prop002')
    expect(out).toContain('Accepted proposal prop002')
    expect(
      readFileSync(
        join(process.env.CLAUDE_CONFIG_DIR as string, 'USER.md'),
        'utf8',
      ),
    ).toContain('concise recall summaries')
  })

  test('memory wipe requires confirmation and removes artifacts', async () => {
    const { queueMemoryProposal } = await import(
      '../services/memory/proposalQueue.js'
    )
    queueMemoryProposal(
      {
        kind: 'fact',
        content: 'Session memory summaries are stored under ~/.claude/sessions/.summaries.',
        evidence_session_id: 'sess-3',
      },
      { generateId: () => 'prop003' },
    )

    const refused = await runKairosCommand('memory wipe')
    expect(refused).toContain('--confirm')

    const wiped = await runKairosCommand('memory wipe --confirm')
    expect(wiped).toContain('Wiped KAIROS session index')
    expect(() =>
      readFileSync(
        join(
          process.env.CLAUDE_CONFIG_DIR as string,
          'memory',
          '.pending-proposals',
          'prop003.json',
        ),
        'utf8',
      ),
    ).toThrow()
  })
})
