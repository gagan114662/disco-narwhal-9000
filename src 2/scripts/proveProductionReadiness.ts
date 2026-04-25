import { readFileSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'

type RunResult = {
  databaseId: number
  workflowName: string
  status: string
  conclusion: string
  headSha: string
  createdAt: string
  url: string
}

type PullRequestCheck = {
  name?: string
  status?: string
  conclusion?: string
  startedAt?: string
  completedAt?: string
  detailsUrl?: string
}

type PullRequest = {
  number: number
  title: string
  url: string
  statusCheckRollup: PullRequestCheck[]
}

const allowedSdkUnsupported = [
  'query',
  'unstable_v2_createSession',
  'unstable_v2_resumeSession',
  'unstable_v2_prompt',
  'watchScheduledTasks',
  'connectRemoteControl',
]

function run(
  command: string,
  args: string[],
  cwd: string,
  capture = false,
): string {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.status !== 0) {
    const stderr = capture ? result.stderr : ''
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status}${
        stderr ? `\n${stderr}` : ''
      }`,
    )
  }
  return capture ? result.stdout.trim() : ''
}

function step(name: string, fn: () => void): void {
  console.log(`\n==> ${name}`)
  fn()
  console.log(`OK: ${name}`)
}

function json<T>(command: string, args: string[], cwd: string): T {
  return JSON.parse(run(command, args, cwd, true)) as T
}

function runTimestamp(check: PullRequestCheck): number {
  return Date.parse(check.completedAt ?? check.startedAt ?? '') || 0
}

function latestChecks(checks: PullRequestCheck[]): PullRequestCheck[] {
  const latest = new Map<string, PullRequestCheck>()
  for (const check of checks) {
    if (!check.name) continue
    const existing = latest.get(check.name)
    if (!existing || runTimestamp(check) >= runTimestamp(existing)) {
      latest.set(check.name, check)
    }
  }
  return [...latest.values()]
}

function assertLatestWorkflowGreen(
  runs: RunResult[],
  workflowName: string,
  headSha: string,
): void {
  const runForHead = runs.find(
    run => run.workflowName === workflowName && run.headSha === headSha,
  )
  if (!runForHead) {
    throw new Error(`No ${workflowName} run found for origin/main ${headSha}`)
  }
  if (runForHead.status !== 'completed' || runForHead.conclusion !== 'success') {
    throw new Error(
      `${workflowName} is not green for ${headSha}: ${runForHead.status}/${runForHead.conclusion} ${runForHead.url}`,
    )
  }
  console.log(`${workflowName}: ${runForHead.url}`)
}

function proveRemoteMain(repoRoot: string): void {
  run('git', ['fetch', 'origin', 'main'], repoRoot, true)
  const mainSha = run('git', ['rev-parse', 'origin/main'], repoRoot, true)
  const runs = json<RunResult[]>(
    'gh',
    [
      'run',
      'list',
      '--branch',
      'main',
      '--limit',
      '20',
      '--json',
      'databaseId,workflowName,status,conclusion,headSha,createdAt,url',
    ],
    repoRoot,
  )

  assertLatestWorkflowGreen(runs, 'ci', mainSha)
  assertLatestWorkflowGreen(runs, 'permanent-structural-fix-daily', mainSha)
}

function proveOpenPrs(repoRoot: string): void {
  const prs = json<PullRequest[]>(
    'gh',
    [
      'pr',
      'list',
      '--state',
      'open',
      '--limit',
      '100',
      '--json',
      'number,title,url,statusCheckRollup',
    ],
    repoRoot,
  )

  const failures: string[] = []
  for (const pr of prs) {
    for (const check of latestChecks(pr.statusCheckRollup ?? [])) {
      if (check.status !== 'COMPLETED' || check.conclusion !== 'SUCCESS') {
        failures.push(
          `#${pr.number} ${check.name}: ${check.status}/${check.conclusion} ${check.detailsUrl ?? pr.url}`,
        )
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Open PR checks are not green:\n${failures.join('\n')}`)
  }
  console.log(`Open PRs checked: ${prs.length}`)
}

function proveSdkStubs(sourceRoot: string): void {
  const sdkEntry = readFileSync(
    join(sourceRoot, 'entrypoints', 'agentSdkTypes.ts'),
    'utf8',
  )
  const found = [
    ...sdkEntry.matchAll(/unsupportedSdkApi\('([^']+)'\)/g),
  ].map(match => match[1]!)

  const unexpected = found.filter(name => !allowedSdkUnsupported.includes(name))
  const missing = allowedSdkUnsupported.filter(name => !found.includes(name))
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      [
        unexpected.length
          ? `Unexpected SDK unsupported surfaces: ${unexpected.join(', ')}`
          : '',
        missing.length
          ? `Expected SDK unsupported surfaces not found: ${missing.join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  console.log(`Documented SDK unsupported surfaces: ${found.join(', ')}`)
}

function main(): void {
  const repoRoot = run('git', ['rev-parse', '--show-toplevel'], process.cwd(), true)
  const sourceRoot = join(repoRoot, 'src 2')

  step('local production pipeline', () => {
    run('bun', ['run', 'pipeline'], sourceRoot)
  })

  step('full local test suite', () => {
    run('bun', ['test'], sourceRoot)
  })

  step('tracked worktree unchanged by proof run', () => {
    if (process.env.PROOF_ALLOW_DIRTY === '1') {
      console.log('Skipped because PROOF_ALLOW_DIRTY=1')
      return
    }
    run('git', ['diff', '--exit-code'], repoRoot, true)
    run('git', ['diff', '--cached', '--exit-code'], repoRoot, true)
  })

  step('latest main workflows are green for origin/main', () => {
    proveRemoteMain(repoRoot)
  })

  step('open PR check rollups have no current red checks', () => {
    proveOpenPrs(repoRoot)
  })

  step('SDK compatibility stubs are explicit and bounded', () => {
    proveSdkStubs(sourceRoot)
  })

  console.log('\nPRODUCTION PROOF PASSED')
}

main()
