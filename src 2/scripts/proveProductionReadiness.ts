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

const workflowFiles = [
  '.github/workflows/ci.yml',
  '.github/workflows/permanent-structural-fix-daily.yml',
  '.github/workflows/trunk-guard.yml',
]

const allowedDisabledCommandStubs = [
  'src 2/commands/ant-trace/index.js',
  'src 2/commands/autofix-pr/index.js',
  'src 2/commands/backfill-sessions/index.js',
  'src 2/commands/break-cache/index.js',
  'src 2/commands/bughunter/index.js',
  'src 2/commands/ctx_viz/index.js',
  'src 2/commands/debug-tool-call/index.js',
  'src 2/commands/env/index.js',
  'src 2/commands/good-claude/index.js',
  'src 2/commands/mock-limits/index.js',
  'src 2/commands/oauth-refresh/index.js',
  'src 2/commands/onboarding/index.js',
  'src 2/commands/perf-issue/index.js',
  'src 2/commands/reset-limits/index.js',
  'src 2/commands/share/index.js',
  'src 2/commands/summary/index.js',
  'src 2/commands/teleport/index.js',
]

const allowedTodoHumanDocs = ['src 2/constants/outputStyles.ts']

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

function trackedFiles(repoRoot: string, prefix: string): string[] {
  const output = run('git', ['ls-files', prefix], repoRoot, true)
  return output ? output.split('\n').filter(Boolean) : []
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

function proveWorkflowActionPins(repoRoot: string): void {
  const badPins: string[] = []
  for (const file of workflowFiles) {
    const workflow = readFileSync(join(repoRoot, file), 'utf8')
    const checkoutPins = [
      ...workflow.matchAll(/actions\/checkout@([^\s]+)/g),
    ].map(match => match[1]!)

    if (checkoutPins.length === 0) {
      badPins.push(`${file}: no actions/checkout pin found`)
      continue
    }

    for (const pin of checkoutPins) {
      if (pin !== 'v5') {
        badPins.push(`${file}: actions/checkout@${pin}`)
      }
    }
  }

  if (badPins.length > 0) {
    throw new Error(
      `Workflow checkout actions must stay on Node 24-ready actions/checkout@v5:\n${badPins.join('\n')}`,
    )
  }

  console.log(`Workflow checkout pins verified: ${workflowFiles.join(', ')}`)
}

function proveNoLiveIncompleteMarkers(repoRoot: string): void {
  const sourceFiles = trackedFiles(repoRoot, 'src 2').filter(file =>
    /\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(file),
  )
  const findings: string[] = []
  const notImplementedPattern = new RegExp('not ' + 'implemented', 'i')
  const throwMarkerPattern = new RegExp(
    'throw new Error\\([^)]*(TODO|stub|not ' + 'implemented)',
    'i',
  )

  for (const file of sourceFiles) {
    const content = readFileSync(join(repoRoot, file), 'utf8')
    const lines = content.split('\n')
    lines.forEach((line, index) => {
      if (/TODO\(human\)/.test(line) && !allowedTodoHumanDocs.includes(file)) {
        findings.push(`${file}:${index + 1}: ${line.trim()}`)
      }
      if (notImplementedPattern.test(line)) {
        findings.push(`${file}:${index + 1}: ${line.trim()}`)
      }
      if (throwMarkerPattern.test(line)) {
        findings.push(`${file}:${index + 1}: ${line.trim()}`)
      }
    })
  }

  if (findings.length > 0) {
    throw new Error(`Live incomplete markers found:\n${findings.join('\n')}`)
  }

  console.log(
    `No live incomplete markers found across ${sourceFiles.length} tracked source files`,
  )
}

function proveDisabledCommandStubs(repoRoot: string): void {
  const commandFiles = trackedFiles(repoRoot, 'src 2/commands').filter(file =>
    file.endsWith('/index.js'),
  )
  const found = commandFiles.filter(file => {
    const content = readFileSync(join(repoRoot, file), 'utf8')
    return (
      content.includes("isEnabled: () => false") &&
      content.includes('isHidden: true') &&
      content.includes("name: 'stub'")
    )
  })

  const unexpected = found.filter(
    file => !allowedDisabledCommandStubs.includes(file),
  )
  const missing = allowedDisabledCommandStubs.filter(
    file => !found.includes(file),
  )

  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      [
        unexpected.length
          ? `Unexpected disabled command stubs: ${unexpected.join(', ')}`
          : '',
        missing.length
          ? `Expected disabled command stubs not found: ${missing.join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  console.log(`Disabled command stubs are bounded: ${found.length}`)
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

  step('workflow checkout actions are Node 24 ready', () => {
    proveWorkflowActionPins(repoRoot)
  })

  step('live incomplete markers are absent', () => {
    proveNoLiveIncompleteMarkers(repoRoot)
  })

  step('disabled command stubs are explicit and bounded', () => {
    proveDisabledCommandStubs(repoRoot)
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
