import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getProjectRoot,
  setProjectRoot,
} from '../bootstrap/state.js'
import { createStateWriter } from '../daemon/kairos/stateWriter.js'
import { writeCronTasks } from '../utils/cronTasks.js'
import {
  __resetKairosCloudSyncDepsForTesting,
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
    expect(out).toContain('/kairos build run')
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

  test('build run creates a Software Factory scaffold with audit and eval paths', async () => {
    const projectDir = makeProjectDir()
    setProjectRoot(projectDir)

    const out = await runKairosCommand(
      'build run Build a vendor onboarding form with reviewer approval and audit trail',
    )

    expect(out).toContain('Software Factory build sf-')
    expect(out).toContain('succeeded')
    expect(out).toContain('eval pack:')
    expect(out).toContain('project eval pack:')
    expect(out).toContain('app dir:')
    expect(out).toContain(process.env.CLAUDE_CONFIG_DIR as string)
    expect(out).toContain(join(projectDir, 'evals', 'software-factory'))
  })

  test('build list, show, and verify inspect persisted Software Factory builds', async () => {
    const projectDir = makeProjectDir()
    setProjectRoot(projectDir)

    const created = await runKairosCommand(
      'build run Build an invoice approval app with reviewer audit trail',
    )
    const buildId = created.match(/Software Factory build (sf-[^:]+):/)?.[1]
    expect(buildId).toBeString()

    const list = await runKairosCommand('build list')
    expect(list).toContain(buildId as string)
    expect(list).toContain('succeeded')
    expect(list).toContain('Invoice Approval App')

    const show = await runKairosCommand(`build show ${buildId}`)
    expect(show).toContain(`Software Factory build ${buildId}: succeeded`)
    expect(show).toContain('eval pack:')
    expect(show).toContain('project eval pack:')
    expect(show).toContain('audit:')

    const verify = await runKairosCommand(`build verify ${buildId}`)
    expect(verify).toContain(`Software Factory build ${buildId}: verified`)
    expect(verify).toContain('PASS audit-chain')
    expect(verify).toContain('PASS code-markers')
    expect(verify).toContain('PASS project-eval-pack')

    const exported = await runKairosCommand(`build export ${buildId}`)
    expect(exported).toContain(
      `Software Factory build ${buildId}: compliance pack exported`,
    )
    expect(exported).toContain('verified: yes')
    expect(exported).toContain('generated files: 5')
    const exportPath = exported.match(/^export: (.+)$/m)?.[1]
    expect(exportPath).toBeString()
    const pack = readJson(exportPath as string) as {
      buildId: string
      verification: { ok: boolean }
      generatedFiles: unknown[]
    }
    expect(pack.buildId).toBe(buildId)
    expect(pack.verification.ok).toBe(true)
    expect(pack.generatedFiles).toHaveLength(5)
  })

  test('build scan reports untraceable generated app files', async () => {
    const projectDir = makeProjectDir()
    setProjectRoot(projectDir)

    const created = await runKairosCommand(
      'build run Build an expense approval app with reviewer audit trail',
    )
    const buildId = created.match(/Software Factory build (sf-[^:]+):/)?.[1]
    const appDir = created.match(/^app dir: (.+)$/m)?.[1]
    expect(buildId).toBeString()
    expect(appDir).toBeString()
    writeFileSync(
      join(appDir as string, 'src', 'unreviewed.ts'),
      'export const bypass = true\n',
    )

    const scan = await runKairosCommand(`build scan ${buildId}`)
    expect(scan).toContain(`Software Factory build ${buildId}: drift detected`)
    expect(scan).toContain('untraceable files: 1')
    expect(scan).toContain('- src/unreviewed.ts')
    expect(scan).toContain('audit event appended: yes')
  })

  test('build reconcile writes a proposed spec delta for untraceable code', async () => {
    const projectDir = makeProjectDir()
    setProjectRoot(projectDir)

    const created = await runKairosCommand(
      'build run Build a vendor risk app with reviewer audit trail',
    )
    const buildId = created.match(/Software Factory build (sf-[^:]+):/)?.[1]
    const appDir = created.match(/^app dir: (.+)$/m)?.[1]
    expect(buildId).toBeString()
    expect(appDir).toBeString()
    writeFileSync(
      join(appDir as string, 'src', 'vendor-risk-score.ts'),
      'export const score = 100\n',
    )

    const reconcile = await runKairosCommand(`build reconcile ${buildId}`)
    expect(reconcile).toContain(
      `Software Factory build ${buildId}: reconciliation proposed`,
    )
    expect(reconcile).toContain('deltas: 1')
    expect(reconcile).toContain('audit event appended: yes')
    const proposalPath = reconcile.match(/^proposal: (.+)$/m)?.[1]
    expect(proposalPath).toBeString()
    const proposal = readJson(proposalPath as string) as {
      deltas: Array<{ sourceFile: string }>
    }
    expect(proposal.deltas[0]?.sourceFile).toBe('src/vendor-risk-score.ts')
  })

  test('build accept-reconciliation restores traceability for proposed drift', async () => {
    const projectDir = makeProjectDir()
    setProjectRoot(projectDir)

    const created = await runKairosCommand(
      'build run Build a supplier review app with reviewer audit trail',
    )
    const buildId = created.match(/Software Factory build (sf-[^:]+):/)?.[1]
    const appDir = created.match(/^app dir: (.+)$/m)?.[1]
    expect(buildId).toBeString()
    expect(appDir).toBeString()
    writeFileSync(
      join(appDir as string, 'src', 'supplier-score.ts'),
      'export const supplierScore = 99\n',
    )

    await runKairosCommand(`build reconcile ${buildId}`)
    const accepted = await runKairosCommand(
      `build accept-reconciliation ${buildId}`,
    )
    expect(accepted).toContain(
      `Software Factory build ${buildId}: reconciliation accepted`,
    )
    expect(accepted).toContain('accepted clauses: CL-004')
    expect(accepted).toContain('audit event appended: yes')

    const verify = await runKairosCommand(`build verify ${buildId}`)
    expect(verify).toContain(`Software Factory build ${buildId}: verified`)
    expect(verify).toContain('PASS untraceable-code')
  })

  test('build change and accept-change apply traceable spec-driven changes', async () => {
    const projectDir = makeProjectDir()
    setProjectRoot(projectDir)

    const created = await runKairosCommand(
      'build run Build an invoice review app with reviewer audit trail',
    )
    const buildId = created.match(/Software Factory build (sf-[^:]+):/)?.[1]
    expect(buildId).toBeString()

    const change = await runKairosCommand(
      `build change ${buildId} Add CSV export for approved invoices`,
    )
    expect(change).toContain(
      `Software Factory build ${buildId}: change proposed`,
    )
    expect(change).toContain('proposed clause: CL-004')
    expect(change).toContain('audit event appended: yes')

    const accepted = await runKairosCommand(`build accept-change ${buildId}`)
    expect(accepted).toContain(
      `Software Factory build ${buildId}: change accepted`,
    )
    expect(accepted).toContain('accepted clause: CL-004')
    expect(accepted).toContain('audit event appended: yes')

    const verify = await runKairosCommand(`build verify ${buildId}`)
    expect(verify).toContain(`Software Factory build ${buildId}: verified`)
    expect(verify).toContain('PASS eval-pack: 4/4')
    expect(verify).toContain('PASS code-markers: 4/4')
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
