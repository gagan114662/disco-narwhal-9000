import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { dirname, extname, join, relative } from 'path'
import { getProjectRoot } from '../../bootstrap/state.js'
import {
  buildIssueIdentifiers,
  buildIssueScaffold,
  getIssueCommandHelp,
  parseIssueKindToken,
  type IssueScaffoldInput,
  type IssueTemplateKind,
  type TrunkExpectation,
} from './scaffold.js'
import { tryParseShellCommand } from '../../utils/bash/shellQuote.js'
import { which } from '../../utils/which.js'
import {
  detectCurrentRepositoryWithHost,
  parseGitHubRepository,
} from '../../utils/detectRepository.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { getGhAuthStatus, type GhAuthStatus } from '../../utils/github/ghAuthStatus.js'

type ParsedIssueCommand = {
  kind: IssueTemplateKind
  title: string
  create: boolean
  repo?: string
  upstreamIds: string[]
  entryPoints: string[]
  labels: string[]
  assignees: string[]
  trunkExpectation?: TrunkExpectation
  draftPath?: string
}

type ValidationResult = {
  blockingErrors: string[]
  warnings: string[]
  resolvedRefs: Array<{ id: string; locations: string[] }>
}

type GitHubIssueMatch = {
  number: number
  title: string
  url: string
}

type ExecResult = {
  stdout: string
  stderr: string
  code: number
  error?: string
}

export type IssueCommandDeps = {
  projectDir?: string
  now?: Date
  mkdir?: typeof mkdir
  writeFile?: typeof writeFile
  readFile?: typeof readFile
  which?: typeof which
  detectRepository?: typeof detectCurrentRepositoryWithHost
  getGhAuthStatus?: () => Promise<GhAuthStatus>
  exec?: (
    file: string,
    args: string[],
    options?: { cwd?: string; input?: string; stdin?: 'pipe' | 'ignore' | 'inherit' },
  ) => Promise<ExecResult>
}

const ISSUE_DRAFTS_DIR = join('.claude', 'issue-drafts')
const TEXT_FILE_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
])
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist'])
const REQUIRED_UPSTREAM_KINDS = new Set<IssueTemplateKind>([
  'spec-design-doc',
  'work-order',
  'leaf-build',
])

const DETERMINISTIC_REF_PATTERN =
  /^(REQ|DES|WO|BUG)-[A-Z0-9-]+-\d{3}$|^AC-(REQ|DES|WO|BUG)-[A-Z0-9-]+-\d{3}\.\d+$|^COV-(REQ|DES|WO|BUG)-[A-Z0-9-]+-\d{3}$/

function parseStringTokens(args: string): string[] | null {
  const parsed = tryParseShellCommand(args)
  if (!parsed.success) return null

  const tokens: string[] = []
  for (const token of parsed.tokens) {
    if (typeof token !== 'string') {
      return null
    }
    tokens.push(token)
  }
  return tokens
}

function splitFlagValues(value: string): string[] {
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
}

function normalizeRepo(repo: string): string | null {
  const trimmed = repo.trim()
  if (!trimmed) return null

  const parsedGitHubRepo = parseGitHubRepository(trimmed)
  if (parsedGitHubRepo) {
    return parsedGitHubRepo
  }

  const slashParts = trimmed.split('/')
  if (slashParts.length === 3 && slashParts.every(Boolean)) {
    return trimmed.replace(/\.git$/, '')
  }

  return null
}

function normalizeRefs(refs: string[]): string[] {
  return Array.from(
    new Set(
      refs
        .map(ref => ref.trim().toUpperCase())
        .filter(Boolean),
    ),
  )
}

export function parseIssueWorkflowArgs(args: string): ParsedIssueCommand | null {
  const tokens = parseStringTokens(args)
  if (!tokens) return null

  let kind: IssueTemplateKind = 'work-order'
  let create = false
  let repo: string | undefined
  let trunkExpectation: TrunkExpectation | undefined
  let draftPath: string | undefined
  const upstreamIds: string[] = []
  const entryPoints: string[] = []
  const labels: string[] = []
  const assignees: string[] = []
  const titleTokens: string[] = []

  const takeValue = (index: number): string | null => tokens[index + 1] ?? null

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!

    if (token === '--create') {
      create = true
      continue
    }
    if (token === '--help' || token === '-h' || token === 'help') {
      return {
        kind,
        title: '',
        create: false,
        repo: undefined,
        upstreamIds: [],
        entryPoints: [],
        labels: [],
        assignees: [],
        trunkExpectation: undefined,
        draftPath: undefined,
      }
    }
    if (token === '--type' || token === '-t') {
      const value = takeValue(i)
      if (!value) return null
      const parsedKind = parseIssueKindToken(value)
      if (!parsedKind) return null
      kind = parsedKind
      i++
      continue
    }
    if (token.startsWith('--type=')) {
      const parsedKind = parseIssueKindToken(token.slice('--type='.length))
      if (!parsedKind) return null
      kind = parsedKind
      continue
    }
    if (token === '--repo' || token === '-R') {
      const value = takeValue(i)
      if (!value) return null
      repo = value
      i++
      continue
    }
    if (token.startsWith('--repo=')) {
      repo = token.slice('--repo='.length)
      continue
    }
    if (token === '--upstream' || token === '-u') {
      const value = takeValue(i)
      if (!value) return null
      upstreamIds.push(...splitFlagValues(value))
      i++
      continue
    }
    if (token.startsWith('--upstream=')) {
      upstreamIds.push(...splitFlagValues(token.slice('--upstream='.length)))
      continue
    }
    if (token === '--entry' || token === '-e') {
      const value = takeValue(i)
      if (!value) return null
      entryPoints.push(value)
      i++
      continue
    }
    if (token.startsWith('--entry=')) {
      entryPoints.push(token.slice('--entry='.length))
      continue
    }
    if (token === '--label' || token === '-l') {
      const value = takeValue(i)
      if (!value) return null
      labels.push(...splitFlagValues(value))
      i++
      continue
    }
    if (token.startsWith('--label=')) {
      labels.push(...splitFlagValues(token.slice('--label='.length)))
      continue
    }
    if (token === '--assignee' || token === '-a') {
      const value = takeValue(i)
      if (!value) return null
      assignees.push(...splitFlagValues(value))
      i++
      continue
    }
    if (token.startsWith('--assignee=')) {
      assignees.push(...splitFlagValues(token.slice('--assignee='.length)))
      continue
    }
    if (token === '--trunk') {
      const value = takeValue(i)
      if (value !== 'trunk-safe' && value !== 'trunk-touch') return null
      trunkExpectation = value
      i++
      continue
    }
    if (token.startsWith('--trunk=')) {
      const value = token.slice('--trunk='.length)
      if (value !== 'trunk-safe' && value !== 'trunk-touch') return null
      trunkExpectation = value
      continue
    }
    if (token === '--draft-path') {
      const value = takeValue(i)
      if (!value) return null
      draftPath = value
      i++
      continue
    }
    if (token.startsWith('--draft-path=')) {
      draftPath = token.slice('--draft-path='.length)
      continue
    }

    const aliasKind = parseIssueKindToken(token)
    if (titleTokens.length === 0 && aliasKind) {
      kind = aliasKind
      continue
    }

    titleTokens.push(token)
  }

  return {
    kind,
    title: titleTokens.join(' ').trim(),
    create,
    repo,
    upstreamIds: normalizeRefs(upstreamIds),
    entryPoints: Array.from(new Set(entryPoints.map(entry => entry.trim()).filter(Boolean))),
    labels: Array.from(new Set(labels.map(label => label.trim()).filter(Boolean))),
    assignees: Array.from(
      new Set(assignees.map(assignee => assignee.trim()).filter(Boolean)),
    ),
    trunkExpectation,
    draftPath: draftPath?.trim() || undefined,
  }
}

async function findLocalReferenceMatches(
  projectDir: string,
  id: string,
  deps: Pick<IssueCommandDeps, 'which' | 'exec' | 'readFile'>,
): Promise<string[]> {
  const resolveWhich = deps.which ?? which
  const exec =
    deps.exec ??
    (async (file, args, options) =>
      execFileNoThrowWithCwd(file, args, { cwd: options?.cwd, input: options?.input, stdin: options?.stdin }))

  if (await resolveWhich('rg')) {
    const result = await exec(
      'rg',
      [
        '-l',
        '--fixed-strings',
        '--glob',
        '!**/node_modules/**',
        '--glob',
        '!**/.git/**',
        '--glob',
        '!**/dist/**',
        id,
        projectDir,
      ],
      { cwd: projectDir },
    )

    if (result.code === 0) {
      return result.stdout
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => relative(projectDir, line))
    }

    if (result.code !== 1) {
      return []
    }
  }

  const found: string[] = []
  const dirsToScan = [projectDir]

  while (dirsToScan.length > 0) {
    const currentDir = dirsToScan.pop()!
    let entries: Awaited<ReturnType<typeof readdir>>
    try {
      entries = await readdir(currentDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const entryPath = join(currentDir, entry.name)

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          dirsToScan.push(entryPath)
        }
        continue
      }

      if (!entry.isFile()) continue
      if (!TEXT_FILE_EXTENSIONS.has(extname(entry.name))) continue

      try {
        const fileStats = await stat(entryPath)
        if (fileStats.size > 512_000) continue
      } catch {
        continue
      }

      let body: string
      try {
        body = await (deps.readFile ?? readFile)(entryPath, 'utf8')
      } catch {
        continue
      }

      if (body.includes(id)) {
        found.push(relative(projectDir, entryPath))
      }
    }
  }

  return found
}

async function findGitHubReferenceMatches(
  id: string,
  repository: string | null,
  deps: Pick<IssueCommandDeps, 'exec' | 'getGhAuthStatus'>,
): Promise<string[]> {
  if (!repository) return []

  const ghStatus = await (deps.getGhAuthStatus ?? getGhAuthStatus)()
  if (ghStatus !== 'authenticated') {
    return []
  }

  const exec =
    deps.exec ??
    (async (file, args, options) =>
      execFileNoThrowWithCwd(file, args, {
        cwd: options?.cwd,
        input: options?.input,
        stdin: options?.stdin,
      }))

  const searchQuery = `${id} in:title,body`
  const result = await exec(
    'gh',
    [
      'issue',
      'list',
      '--repo',
      repository,
      '--state',
      'all',
      '--search',
      searchQuery,
      '--limit',
      '10',
      '--json',
      'number,title,url',
    ],
    {},
  )

  if (result.code !== 0 || !result.stdout.trim()) {
    return []
  }

  let matches: GitHubIssueMatch[] = []
  try {
    matches = JSON.parse(result.stdout) as GitHubIssueMatch[]
  } catch {
    return []
  }

  return matches
    .filter(match => typeof match.number === 'number' && typeof match.url === 'string')
    .map(match => `github issue #${match.number}: ${match.url}`)
}

async function validateUpstreamRefs(
  command: ParsedIssueCommand,
  projectDir: string,
  repository: string | null,
  deps: Pick<IssueCommandDeps, 'which' | 'exec' | 'readFile' | 'getGhAuthStatus'>,
): Promise<ValidationResult> {
  const blockingErrors: string[] = []
  const warnings: string[] = []
  const resolvedRefs: Array<{ id: string; locations: string[] }> = []

  if (REQUIRED_UPSTREAM_KINDS.has(command.kind) && command.upstreamIds.length === 0) {
    blockingErrors.push(
      `${command.kind === 'spec-design-doc' ? 'Design docs' : 'Work orders'} require at least one --upstream REQ/DES/AC/COV reference.`,
    )
  }

  for (const id of command.upstreamIds) {
    if (!DETERMINISTIC_REF_PATTERN.test(id)) {
      blockingErrors.push(
        `Invalid upstream reference "${id}". Expected REQ/DES/WO/BUG IDs plus optional AC-/COV- prefixes.`,
      )
      continue
    }

    const locations = await findLocalReferenceMatches(projectDir, id, deps)
    if (locations.length > 0) {
      resolvedRefs.push({ id, locations })
      continue
    }

    const githubLocations = await findGitHubReferenceMatches(
      id,
      repository,
      deps,
    )
    if (githubLocations.length === 0) {
      warnings.push(`Upstream reference ${id} was not found in the local repo.`)
      continue
    }

    resolvedRefs.push({ id, locations: githubLocations })
  }

  return {
    blockingErrors,
    warnings,
    resolvedRefs,
  }
}

function formatRepositoryForGh(
  repo:
    | string
    | Awaited<ReturnType<typeof detectCurrentRepositoryWithHost>>
    | undefined
    | null,
): string | null {
  if (!repo) return null
  if (typeof repo === 'string') {
    return normalizeRepo(repo)
  }
  if (repo.host === 'github.com') {
    return `${repo.owner}/${repo.name}`
  }
  return `${repo.host}/${repo.owner}/${repo.name}`
}

function buildDraftPath(
  projectDir: string,
  command: ParsedIssueCommand,
): string {
  if (command.draftPath) {
    return command.draftPath.startsWith('/')
      ? command.draftPath
      : join(projectDir, command.draftPath)
  }

  const identifiers = buildIssueIdentifiers(
    command.kind,
    command.title || 'TODO issue title',
  )
  return join(projectDir, ISSUE_DRAFTS_DIR, `${identifiers.artifactId}.md`)
}

async function createGitHubIssue(
  repo: string,
  command: ParsedIssueCommand,
  draftPath: string,
  projectDir: string,
  deps: Pick<IssueCommandDeps, 'exec' | 'getGhAuthStatus'>,
): Promise<{ url?: string; error?: string }> {
  const ghStatus = await (deps.getGhAuthStatus ?? getGhAuthStatus)()
  if (ghStatus === 'not_installed') {
    return { error: 'GitHub CLI (`gh`) is not installed.' }
  }
  if (ghStatus !== 'authenticated') {
    return { error: 'GitHub CLI is not authenticated. Run `gh auth login`.' }
  }

  const exec =
    deps.exec ??
    (async (file, args, options) =>
      execFileNoThrowWithCwd(file, args, { cwd: options?.cwd, input: options?.input, stdin: options?.stdin }))

  const createArgs = [
    'issue',
    'create',
    '--repo',
    repo,
    '--title',
    command.title,
    '--body-file',
    draftPath,
  ]
  for (const label of command.labels) {
    createArgs.push('--label', label)
  }
  for (const assignee of command.assignees) {
    createArgs.push('--assignee', assignee)
  }

  const result = await exec('gh', createArgs, { cwd: projectDir })
  if (result.code !== 0) {
    return {
      error: result.stderr.trim() || result.error || 'gh issue create failed.',
    }
  }

  return { url: result.stdout.trim() || undefined }
}

export async function runIssueCommand(
  args: string,
  deps: IssueCommandDeps = {},
): Promise<string> {
  const trimmedArgs = args.trim()
  if (trimmedArgs === '' || trimmedArgs === 'help' || trimmedArgs === '--help' || trimmedArgs === '-h') {
    return getIssueCommandHelp()
  }

  const command = parseIssueWorkflowArgs(trimmedArgs)
  if (!command || !command.title) {
    return `${getIssueCommandHelp()}\n\nInvalid /issue arguments.`
  }

  const projectDir = deps.projectDir ?? getProjectRoot()
  const repoInfo = command.repo
    ? command.repo
    : await (deps.detectRepository ?? detectCurrentRepositoryWithHost)()
  const repository = formatRepositoryForGh(repoInfo)
  const validation = await validateUpstreamRefs(
    command,
    projectDir,
    repository,
    deps,
  )

  const scaffoldInput: IssueScaffoldInput = {
    kind: command.kind,
    title: command.title,
    repository: repository ?? undefined,
    generatedAt: (deps.now ?? new Date()).toISOString(),
    upstreamIds: command.upstreamIds,
    entryPoints: command.entryPoints,
    trunkExpectation: command.trunkExpectation,
  }
  const body = buildIssueScaffold(scaffoldInput)

  const draftPath = buildDraftPath(projectDir, command)
  await (deps.mkdir ?? mkdir)(dirname(draftPath), { recursive: true })
  await (deps.writeFile ?? writeFile)(draftPath, `${body}\n`, 'utf8')

  let createResult: { url?: string; error?: string } | null = null
  if (command.create) {
    if (validation.blockingErrors.length > 0) {
      createResult = {
        error: 'Issue creation skipped because validation failed.',
      }
    } else if (!repository) {
      createResult = {
        error:
          'Issue creation skipped because the repository could not be detected. Use --repo owner/repo.',
      }
    } else {
      createResult = await createGitHubIssue(
        repository,
        command,
        draftPath,
        projectDir,
        deps,
      )
    }
  }

  const output: string[] = []
  output.push(`Draft written to ${relative(projectDir, draftPath) || draftPath}`)
  output.push(`Artifact ID: ${buildIssueIdentifiers(command.kind, command.title).artifactId}`)
  if (repository) {
    output.push(`Repository: ${repository}`)
  }
  if (command.upstreamIds.length > 0) {
    output.push(`Upstream refs: ${command.upstreamIds.join(', ')}`)
  }

  output.push('')
  output.push('Validation:')
  if (
    validation.blockingErrors.length === 0 &&
    validation.warnings.length === 0 &&
    validation.resolvedRefs.length === 0
  ) {
    output.push('- No validation problems found.')
  } else {
    for (const error of validation.blockingErrors) {
      output.push(`- BLOCKING: ${error}`)
    }
    for (const warning of validation.warnings) {
      output.push(`- WARNING: ${warning}`)
    }
  }
  for (const resolved of validation.resolvedRefs) {
    output.push(
      `- RESOLVED: ${resolved.id} -> ${resolved.locations.join(', ')}`,
    )
  }

  if (command.create) {
    output.push('')
    output.push('GitHub:')
    if (createResult?.url) {
      output.push(`- Created issue: ${createResult.url}`)
    } else if (createResult?.error) {
      output.push(`- ${createResult.error}`)
    }
  }

  output.push('')
  output.push(body)

  return output.join('\n')
}
