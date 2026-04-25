import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getProjectRoot,
  setProjectRoot,
} from '../bootstrap/state.js'
import {
  getProjectKairosBuildEventsPath,
  getProjectKairosBuildManifestPath,
  getProjectKairosBuildSpecPath,
} from '../daemon/kairos/paths.js'
import { createStateWriter } from '../daemon/kairos/stateWriter.js'
import { writeCronTasks } from '../utils/cronTasks.js'
import {
  __resetKairosBuildDepsForTesting,
  __resetKairosCloudSyncDepsForTesting,
  __setKairosBuildDepsForTesting,
  __setKairosCloudSyncDepsForTesting,
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
    expect(out).toContain('/kairos cloud deploy')
    expect(out).toContain('/kairos cloud-sync')
  })

  test('prints help for unknown subcommands', async () => {
    const out = await runKairosCommand('bogus')
    expect(out).toContain('Usage:')
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
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
  })

  test('build-events prints persisted build lifecycle events', async () => {
    const projectDir = makeProjectDir()
    __setKairosBuildDepsForTesting({
      generateBuildId: () => 'events-build',
      now: () => new Date('2026-04-25T18:45:00.000Z'),
    })
    await runKairosCommand(`build ${projectDir} leave request app`)

    const out = await runKairosCommand(`build-events ${projectDir} events-build`)
    expect(out.split('\n')).toEqual([
      'Events for events-build:',
      '- 2026-04-25T18:45:00.000Z build_created status=draft',
      `- 2026-04-25T18:45:00.000Z spec_written spec=${getProjectKairosBuildSpecPath(projectDir, 'events-build')}`,
      `summary command: /kairos build-summary ${projectDir} events-build`,
      `progress command: /kairos build-progress ${projectDir} events-build`,
    ])
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
      'Supported kinds: build_created, build_status_changed, spec_written, slice_selected, next_slice_prompt_rendered, slice_completed, clarifying_question_answered, agent_event_recorded, build_result_written, build_failed',
      'Usage: /kairos build-events [projectDir] <buildId> [lines] [--kind <kind>]',
    ])
  })

  test('build-events reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(`build-events ${projectDir} missing-build`)
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
      'clarifying_question_answered question=1 answer=employee manager and HR approver',
    )

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

  test('build-questions reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-questions ${projectDir} missing-build`,
    )
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(lines.slice(0, -4)).toEqual([
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
      'assumptions: 4',
      'risks: 4',
      'tracer slices: 3',
      'completed slices: 0',
      'traceability seeds: 1',
    ])
    expect(lines.at(-4)?.startsWith('last event: slice_selected at ')).toBe(
      true,
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
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(lines.slice(7)).toEqual([
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
    expect(lines.slice(7)).toEqual([
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
    expect(lines.slice(7)).toEqual([
      'next command: —',
      'blockers: none',
    ])
  })

  test('build-readiness reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-readiness ${projectDir} missing-build`,
    )
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(out).toBe('No tracer slice TB-9 found for select-build.')
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
    expect(out).toBe(
      'No incomplete tracer slice found after TB-3 for all-complete-build.',
    )
  })

  test('build-select-next reports a missing build clearly', async () => {
    const projectDir = makeProjectDir()
    const out = await runKairosCommand(
      `build-select-next ${projectDir} missing-build`,
    )
    expect(out).toBe(`No build missing-build found for ${projectDir}.`)
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
    expect(out).toBe('Completed TB-1 for complete-build: Record intake skeleton')
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
    expect(out).toBe(
      'Tracer slice TB-1 is already complete for complete-build: Record intake skeleton',
    )

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
