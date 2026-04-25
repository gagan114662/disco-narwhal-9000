import { readFileSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { parse } from 'yaml'

type RunResult = {
  databaseId: number
  workflowName: string
  status: string
  conclusion: string
  headSha: string
  createdAt: string
  url: string
}

type RunStep = {
  name: string
  status: string
  conclusion: string | null
}

type RunJob = {
  name: string
  status: string
  conclusion: string | null
  steps: RunStep[]
}

type RunView = {
  jobs: RunJob[]
}

type BranchProtection = {
  required_status_checks?: {
    strict: boolean
    contexts?: string[]
    checks?: Array<{ context: string }>
  }
  enforce_admins?: { enabled: boolean }
  allow_force_pushes?: { enabled: boolean }
  allow_deletions?: { enabled: boolean }
}

type ActionsWorkflowPermissions = {
  default_workflow_permissions: string
  can_approve_pull_request_reviews: boolean
}

type RepositorySecurityAnalysis = {
  dependabot_security_updates?: { status?: string }
  secret_scanning?: { status?: string }
  secret_scanning_push_protection?: { status?: string }
}

type RepositoryDetails = {
  security_and_analysis?: RepositorySecurityAnalysis
}

type DependabotUpdate = {
  'package-ecosystem'?: string
  directory?: string
  schedule?: {
    interval?: string
    day?: string
    time?: string
    timezone?: string
  }
  'open-pull-requests-limit'?: number
  ignore?: Array<{
    'dependency-name'?: string
    versions?: string[]
  }>
}

type DependabotConfig = {
  version?: number
  updates?: DependabotUpdate[]
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
  '.github/workflows/codeql.yml',
  '.github/workflows/container-scan.yml',
  '.github/workflows/flake-detection.yml',
  '.github/workflows/mutation-test.yml',
  '.github/workflows/permanent-structural-fix-daily.yml',
  '.github/workflows/pr-hygiene.yml',
  '.github/workflows/proof-production-nightly.yml',
  '.github/workflows/release.yml',
  '.github/workflows/sbom.yml',
  '.github/workflows/scorecard.yml',
  '.github/workflows/secret-scan.yml',
  '.github/workflows/trunk-guard.yml',
]

const workflowSupplyChainFiles = [
  '.github/workflows/ci.yml',
  '.github/workflows/permanent-structural-fix-daily.yml',
]

const workflowStaticProofFiles = [
  '.github/workflows/ci.yml',
  '.github/workflows/permanent-structural-fix-daily.yml',
]

const requiredWorkflowPermissions: Record<string, string[]> = {
  '.github/workflows/ci.yml': ['contents: read'],
  '.github/workflows/codeql.yml': [
    'contents: read',
    'security-events: write',
    'actions: read',
  ],
  '.github/workflows/container-scan.yml': [
    'contents: read',
    'security-events: write',
  ],
  '.github/workflows/flake-detection.yml': ['contents: read'],
  '.github/workflows/mutation-test.yml': ['contents: read'],
  '.github/workflows/permanent-structural-fix-daily.yml': ['contents: read'],
  '.github/workflows/pr-hygiene.yml': [
    'contents: read',
    'pull-requests: read',
  ],
  '.github/workflows/proof-production-nightly.yml': ['contents: read'],
  '.github/workflows/release.yml': [
    'contents: write',
    'id-token: write',
    'attestations: write',
    'packages: read',
  ],
  '.github/workflows/sbom.yml': ['contents: read', 'id-token: write'],
  '.github/workflows/scorecard.yml': [
    'contents: read',
    'actions: read',
    'security-events: write',
    'id-token: write',
  ],
  '.github/workflows/secret-scan.yml': ['contents: read'],
  '.github/workflows/trunk-guard.yml': [
    'contents: read',
    'pull-requests: read',
  ],
}

const requiredHostedWorkflowSteps: Record<string, string[]> = {
  ci: [
    'Install dependencies',
    'Audit dependencies',
    'Run production pipeline',
    'Run full test suite',
    'Run static production proof gates',
  ],
  'permanent-structural-fix-daily': [
    'Install dependencies',
    'Audit dependencies',
    'Run permanent structural fix loop',
    'Run static production proof gates',
  ],
}

const requiredMainBranchChecks = ['block-trunk-changes', 'verify']

const requiredDependabotUpdates = [
  {
    ecosystem: 'bun',
    directory: '/src 2',
    time: '10:00',
    ignoredVersions: [
      { dependency: 'eslint', versions: ['>=10'] },
      { dependency: 'ink', versions: ['>=6'] },
      { dependency: 'typescript', versions: ['>=6'] },
    ],
  },
  {
    ecosystem: 'github-actions',
    directory: '/',
    time: '10:30',
    ignoredVersions: [
      { dependency: 'actions/checkout', versions: ['>=6'] },
    ],
  },
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
  extraEnv: Record<string, string> = {},
): string {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
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

function workflowRunTimestamp(run: RunResult): number {
  return Date.parse(run.createdAt) || 0
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

function latestWorkflowRun(
  runs: RunResult[],
  workflowName: string,
  headSha: string,
): RunResult | undefined {
  return runs
    .filter(run => run.workflowName === workflowName && run.headSha === headSha)
    .sort((a, b) => workflowRunTimestamp(b) - workflowRunTimestamp(a))[0]
}

function trackedFiles(repoRoot: string, prefix: string): string[] {
  const output = run('git', ['ls-files', prefix], repoRoot, true)
  return output ? output.split('\n').filter(Boolean) : []
}

function repoSlug(repoRoot: string): string {
  return run(
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    repoRoot,
    true,
  )
}

function assertLatestWorkflowGreen(
  runs: RunResult[],
  workflowName: string,
  headSha: string,
): RunResult {
  const runForHead = latestWorkflowRun(runs, workflowName, headSha)
  if (!runForHead) {
    throw new Error(`No ${workflowName} run found for origin/main ${headSha}`)
  }
  if (runForHead.status !== 'completed' || runForHead.conclusion !== 'success') {
    throw new Error(
      `${workflowName} is not green for ${headSha}: ${runForHead.status}/${runForHead.conclusion} ${runForHead.url}`,
    )
  }
  console.log(`${workflowName}: ${runForHead.url}`)
  return runForHead
}

function proveHostedWorkflowSteps(repoRoot: string, runResult: RunResult): void {
  const requiredSteps = requiredHostedWorkflowSteps[runResult.workflowName]
  if (!requiredSteps) {
    throw new Error(
      `No required hosted steps configured for ${runResult.workflowName}`,
    )
  }

  const runView = json<RunView>(
    'gh',
    ['run', 'view', String(runResult.databaseId), '--json', 'jobs'],
    repoRoot,
  )
  const steps = runView.jobs.flatMap(job =>
    (job.steps ?? []).map(step => ({ ...step, jobName: job.name })),
  )
  const failures: string[] = []

  for (const stepName of requiredSteps) {
    const step = steps.find(candidate => candidate.name === stepName)
    if (!step) {
      failures.push(`${runResult.workflowName}: missing hosted step "${stepName}"`)
      continue
    }
    if (step.status !== 'completed' || step.conclusion !== 'success') {
      failures.push(
        `${runResult.workflowName}: step "${stepName}" in job "${step.jobName}" is ${step.status}/${step.conclusion}`,
      )
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Hosted workflow step receipts are not green:\n${failures.join('\n')}`,
    )
  }

  console.log(
    `${runResult.workflowName} hosted steps verified: ${requiredSteps.join(', ')}`,
  )
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

  const ciRun = assertLatestWorkflowGreen(runs, 'ci', mainSha)
  const dailyRun = assertLatestWorkflowGreen(
    runs,
    'permanent-structural-fix-daily',
    mainSha,
  )
  proveHostedWorkflowSteps(repoRoot, ciRun)
  proveHostedWorkflowSteps(repoRoot, dailyRun)
}

function proveMainBranchProtection(repoRoot: string): void {
  const protection = json<BranchProtection>(
    'gh',
    ['api', `repos/${repoSlug(repoRoot)}/branches/main/protection`],
    repoRoot,
  )
  const requiredChecks = new Set([
    ...(protection.required_status_checks?.contexts ?? []),
    ...(protection.required_status_checks?.checks ?? []).map(
      check => check.context,
    ),
  ])
  const failures: string[] = []

  if (protection.required_status_checks?.strict !== true) {
    failures.push('main branch must require branches to be up to date')
  }

  for (const check of requiredMainBranchChecks) {
    if (!requiredChecks.has(check)) {
      failures.push(`main branch must require status check "${check}"`)
    }
  }

  if (protection.enforce_admins?.enabled !== true) {
    failures.push('main branch protection must include administrators')
  }

  if (protection.allow_force_pushes?.enabled !== false) {
    failures.push('main branch must not allow force pushes')
  }

  if (protection.allow_deletions?.enabled !== false) {
    failures.push('main branch must not allow deletions')
  }

  if (failures.length > 0) {
    throw new Error(
      `Main branch protection is not production-ready:\n${failures.join('\n')}`,
    )
  }

  console.log(
    `Main branch protection verified: required checks ${requiredMainBranchChecks.join(
      ', ',
    )}`,
  )
}

function proveActionsDefaultWorkflowPermissions(repoRoot: string): void {
  const permissions = json<ActionsWorkflowPermissions>(
    'gh',
    ['api', `repos/${repoSlug(repoRoot)}/actions/permissions/workflow`],
    repoRoot,
  )
  const failures: string[] = []

  if (permissions.default_workflow_permissions !== 'read') {
    failures.push(
      `default workflow token permissions are ${permissions.default_workflow_permissions}, expected read`,
    )
  }

  if (permissions.can_approve_pull_request_reviews !== false) {
    failures.push('workflow token must not be able to approve pull requests')
  }

  if (failures.length > 0) {
    throw new Error(
      `Repository Actions workflow permissions are not production-ready:\n${failures.join('\n')}`,
    )
  }

  console.log('Repository Actions default workflow permissions verified: read')
}

function proveRepositorySecuritySettings(repoRoot: string): void {
  const repo = json<RepositoryDetails>(
    'gh',
    ['api', `repos/${repoSlug(repoRoot)}`],
    repoRoot,
  )
  const security = repo.security_and_analysis
  const failures: string[] = []

  if (security?.dependabot_security_updates?.status !== 'enabled') {
    failures.push('Dependabot security updates must be enabled')
  }
  if (security?.secret_scanning?.status !== 'enabled') {
    failures.push('secret scanning must be enabled')
  }
  if (security?.secret_scanning_push_protection?.status !== 'enabled') {
    failures.push('secret scanning push protection must be enabled')
  }

  if (failures.length > 0) {
    throw new Error(
      `Repository security settings are not production-ready:\n${failures.join(
        '\n',
      )}`,
    )
  }

  console.log(
    'Repository security settings verified: Dependabot security updates, secret scanning, push protection',
  )
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

function proveDependabotPolicy(repoRoot: string): void {
  const config = parse(
    readFileSync(join(repoRoot, '.github', 'dependabot.yml'), 'utf8'),
  ) as DependabotConfig
  const failures: string[] = []

  if (config.version !== 2) {
    failures.push('Dependabot config must use version: 2')
  }

  for (const required of requiredDependabotUpdates) {
    const update = (config.updates ?? []).find(
      candidate =>
        candidate['package-ecosystem'] === required.ecosystem &&
        candidate.directory === required.directory,
    )

    if (!update) {
      failures.push(
        `Dependabot must watch ${required.ecosystem} in ${required.directory}`,
      )
      continue
    }

    if (update.schedule?.interval !== 'weekly') {
      failures.push(
        `${required.ecosystem} updates must run on a weekly schedule`,
      )
    }
    if (update.schedule?.day !== 'monday') {
      failures.push(`${required.ecosystem} updates must run on monday`)
    }
    if (update.schedule?.timezone !== 'America/Toronto') {
      failures.push(
        `${required.ecosystem} updates must use America/Toronto timezone`,
      )
    }
    if (update.schedule?.time !== required.time) {
      failures.push(
        `${required.ecosystem} updates must run at ${required.time}`,
      )
    }
    if (update['open-pull-requests-limit'] !== 5) {
      failures.push(
        `${required.ecosystem} updates must cap open PRs at 5`,
      )
    }

    for (const ignored of required.ignoredVersions) {
      const ignoreRule = (update.ignore ?? []).find(
        candidate => candidate['dependency-name'] === ignored.dependency,
      )
      if (!ignoreRule) {
        failures.push(
          `${required.ecosystem} updates must ignore known-breaking ${ignored.dependency} versions`,
        )
        continue
      }

      for (const version of ignored.versions) {
        if (!(ignoreRule.versions ?? []).includes(version)) {
          failures.push(
            `${required.ecosystem} updates must ignore ${ignored.dependency} ${version}`,
          )
        }
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Dependabot update policy is not production-ready:\n${failures.join(
        '\n',
      )}`,
    )
  }

  console.log(
    `Dependabot update policy verified: ${requiredDependabotUpdates
      .map(update => `${update.ecosystem} ${update.directory}`)
      .join(', ')}`,
  )
}

function proveWorkflowActionPins(repoRoot: string): void {
  const badPins: string[] = []
  const usesPattern = /^\s*uses:\s*(?<ref>[^\s#]+)(?:\s+#.*)?$/gm

  for (const file of workflowFiles) {
    const workflow = readFileSync(join(repoRoot, file), 'utf8')
    const matches = [...workflow.matchAll(usesPattern)]

    if (matches.length === 0) {
      badPins.push(`${file}: no action uses entries found`)
      continue
    }

    for (const m of matches) {
      const ref = m.groups?.ref ?? ''
      const pin = ref.split('@').at(-1) ?? ''
      if (!ref.includes('@') || !/^[0-9a-f]{40}$/.test(pin)) {
        badPins.push(`${file}: ${ref}`)
      }
    }
  }

  if (badPins.length > 0) {
    throw new Error(
      `Workflow actions must be pinned by full commit SHA:\n${badPins.join('\n')}`,
    )
  }

  console.log(`Workflow action SHA pins verified: ${workflowFiles.join(', ')}`)
}

function proveWorkflowSupplyChainGates(repoRoot: string): void {
  const missing: string[] = []

  for (const file of workflowSupplyChainFiles) {
    const workflow = readFileSync(join(repoRoot, file), 'utf8')
    if (!workflow.includes('bun install --frozen-lockfile')) {
      missing.push(`${file}: missing bun install --frozen-lockfile`)
    }
    if (!workflow.includes('bun audit')) {
      missing.push(`${file}: missing bun audit`)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Workflow supply-chain gates must stay enabled:\n${missing.join('\n')}`,
    )
  }

  console.log(
    `Workflow supply-chain gates verified: ${workflowSupplyChainFiles.join(', ')}`,
  )
}

function proveWorkflowStaticProofGates(repoRoot: string): void {
  const missing: string[] = []

  for (const file of workflowStaticProofFiles) {
    const workflow = readFileSync(join(repoRoot, file), 'utf8')
    if (!workflow.includes('bun run proof:static')) {
      missing.push(`${file}: missing bun run proof:static`)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Workflow static production proof gates must stay enabled:\n${missing.join('\n')}`,
    )
  }

  console.log(
    `Workflow static production proof gates verified: ${workflowStaticProofFiles.join(', ')}`,
  )
}

function proveWorkflowTokenPermissions(repoRoot: string): void {
  const failures: string[] = []
  const permissionPattern = /^\s*(?<name>[a-z-]+):\s*(?<level>read|write)\s*$/gm

  for (const [file, permissions] of Object.entries(requiredWorkflowPermissions)) {
    const workflow = readFileSync(join(repoRoot, file), 'utf8')
    const expected = new Set(permissions)
    const found = new Set<string>()
    for (const match of workflow.matchAll(permissionPattern)) {
      found.add(`${match.groups?.name}: ${match.groups?.level}`)
    }

    for (const permission of expected) {
      if (!found.has(permission)) {
        failures.push(`${file}: missing permission "${permission}"`)
      }
    }

    if (/^\s*permissions:\s*(?:read-all|write-all)\s*$/m.test(workflow)) {
      failures.push(`${file}: must not use broad read-all/write-all permissions`)
    }

    for (const permission of found) {
      if (permission.endsWith(': write') && !expected.has(permission)) {
        failures.push(`${file}: unexpected write permission "${permission}"`)
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Workflow token permissions are not least-privilege:\n${failures.join('\n')}`,
    )
  }

  console.log(
    `Workflow token permissions verified: ${Object.keys(
      requiredWorkflowPermissions,
    ).join(', ')}`,
  )
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

function proveDisabledCommandStubsHiddenAtRuntime(sourceRoot: string): void {
  const blockedCommandNames = [
    'stub',
    ...allowedDisabledCommandStubs.map(file => file.split('/').at(-2)!),
  ]
  const script = `
    import { getCommands } from './commands.ts'

    const blockedCommandNames = ${JSON.stringify(blockedCommandNames)}
    const names = new Set((await getCommands(process.cwd())).map(command => command.name))
    const exposed = blockedCommandNames.filter(name => names.has(name))

    if (exposed.length > 0) {
      console.error('Disabled command stubs exposed at runtime: ' + exposed.join(', '))
      process.exit(1)
    }

    console.log('Disabled command stubs hidden at runtime: ' + blockedCommandNames.length)
  `

  run('bun', ['-e', script], sourceRoot, false, {
    IS_DEMO: '',
    NODE_ENV: 'test',
    USER_TYPE: 'ant',
  })
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

function proveNoNonRunningTests(repoRoot: string): void {
  const testFiles = trackedFiles(repoRoot, 'src 2').filter(file =>
    /\.(test|spec)\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(file),
  )
  const modifierPattern =
    /\b(?:describe|test|it)\s*\.\s*(?:only|skip|todo|failing)\b(?:\s*\.\s*each\b)?\s*\(/g
  const findings: string[] = []

  for (const file of testFiles) {
    const content = readFileSync(join(repoRoot, file), 'utf8')
    const lines = content.split('\n')
    lines.forEach((line, index) => {
      if (modifierPattern.test(line)) {
        findings.push(`${file}:${index + 1}: ${line.trim()}`)
      }
      modifierPattern.lastIndex = 0
    })
  }

  if (findings.length > 0) {
    throw new Error(
      `Focused, skipped, pending, or expected-failing tests found:\n${findings.join('\n')}`,
    )
  }

  console.log(
    `No focused, skipped, pending, or expected-failing tests found across ${testFiles.length} test files`,
  )
}

function proveTrackedWorktreeClean(repoRoot: string): void {
  if (process.env.PROOF_ALLOW_DIRTY === '1') {
    console.log('Skipped because PROOF_ALLOW_DIRTY=1')
    return
  }
  run('git', ['diff', '--exit-code'], repoRoot, true)
  run('git', ['diff', '--cached', '--exit-code'], repoRoot, true)
}

function proveStaticGates(repoRoot: string, sourceRoot: string): void {
  step('tracked worktree clean before static proof run', () => {
    proveTrackedWorktreeClean(repoRoot)
  })

  step(
    'test suite has no focused, skipped, pending, or expected-failing tests',
    () => {
      proveNoNonRunningTests(repoRoot)
    },
  )

  step('tracked worktree unchanged by static proof run', () => {
    proveTrackedWorktreeClean(repoRoot)
  })

  step('workflow checkout actions are Node 24 ready', () => {
    proveWorkflowActionPins(repoRoot)
  })

  step('workflow supply-chain gates are enabled', () => {
    proveWorkflowSupplyChainGates(repoRoot)
  })

  step('workflow static production proof gates are enabled', () => {
    proveWorkflowStaticProofGates(repoRoot)
  })

  step('workflow token permissions are least-privilege', () => {
    proveWorkflowTokenPermissions(repoRoot)
  })

  step('Dependabot update policy is enabled', () => {
    proveDependabotPolicy(repoRoot)
  })

  step('live incomplete markers are absent', () => {
    proveNoLiveIncompleteMarkers(repoRoot)
  })

  step('disabled command stubs are explicit and bounded', () => {
    proveDisabledCommandStubs(repoRoot)
  })

  step('disabled command stubs are hidden at runtime', () => {
    proveDisabledCommandStubsHiddenAtRuntime(sourceRoot)
  })

  step('SDK compatibility stubs are explicit and bounded', () => {
    proveSdkStubs(sourceRoot)
  })
}

function main(): void {
  const repoRoot = run('git', ['rev-parse', '--show-toplevel'], process.cwd(), true)
  const sourceRoot = join(repoRoot, 'src 2')
  const staticOnly = process.argv.includes('--static')

  if (staticOnly) {
    proveStaticGates(repoRoot, sourceRoot)
    console.log('\nSTATIC PRODUCTION PROOF PASSED')
    return
  }

  step('tracked worktree clean before proof run', () => {
    proveTrackedWorktreeClean(repoRoot)
  })

  step('dependency lockfile installs reproducibly', () => {
    run('bun', ['install', '--frozen-lockfile'], sourceRoot)
  })

  step('supply-chain audit has no known vulnerabilities', () => {
    run('bun', ['audit'], sourceRoot)
  })

  step('local production pipeline', () => {
    run('bun', ['run', 'pipeline'], sourceRoot)
  })

  step('full-tree typecheck against baseline', () => {
    run('bun', ['run', 'typecheck:full'], sourceRoot)
  })

  step('full-tree lint against baseline', () => {
    run('bun', ['run', 'lint:full'], sourceRoot)
  })

  step('full local test suite', () => {
    run('bun', ['test'], sourceRoot)
  })

  step('full local test suite with coverage', () => {
    run('bun', ['run', 'test:coverage'], sourceRoot)
  })

  step('bundle artifact verification', () => {
    run('bun', ['run', 'bundle:budget'], sourceRoot)
  })

  step('bundle reproducibility check', () => {
    run('bun', ['run', 'bundle:reproducibility'], sourceRoot)
  })

  step('performance benchmark', () => {
    run('bun', ['run', 'perf:bench'], sourceRoot)
  })

  step('dashboard E2E', () => {
    run('bun', ['run', 'e2e:dashboard'], sourceRoot)
  })

  step('license policy check', () => {
    run('bun', ['run', 'license:check'], sourceRoot)
  })

  step(
    'test suite has no focused, skipped, pending, or expected-failing tests',
    () => {
      proveNoNonRunningTests(repoRoot)
    },
  )

  step('tracked worktree unchanged by proof run', () => {
    proveTrackedWorktreeClean(repoRoot)
  })

  step('workflow checkout actions are Node 24 ready', () => {
    proveWorkflowActionPins(repoRoot)
  })

  step('workflow supply-chain gates are enabled', () => {
    proveWorkflowSupplyChainGates(repoRoot)
  })

  step('workflow static production proof gates are enabled', () => {
    proveWorkflowStaticProofGates(repoRoot)
  })

  step('workflow token permissions are least-privilege', () => {
    proveWorkflowTokenPermissions(repoRoot)
  })

  step('live incomplete markers are absent', () => {
    proveNoLiveIncompleteMarkers(repoRoot)
  })

  step('disabled command stubs are explicit and bounded', () => {
    proveDisabledCommandStubs(repoRoot)
  })

  step('disabled command stubs are hidden at runtime', () => {
    proveDisabledCommandStubsHiddenAtRuntime(sourceRoot)
  })

  step('latest main workflows are green for origin/main', () => {
    proveRemoteMain(repoRoot)
  })

  step('main branch protection requires green checks', () => {
    proveMainBranchProtection(repoRoot)
  })

  step('repository Actions default permissions are read-only', () => {
    proveActionsDefaultWorkflowPermissions(repoRoot)
  })

  step('repository security settings are enabled', () => {
    proveRepositorySecuritySettings(repoRoot)
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
