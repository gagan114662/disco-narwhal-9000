import { createHash, randomUUID } from 'crypto'
import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join, normalize, relative } from 'path'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  getKairosSoftwareFactoryBuildDir,
  getKairosSoftwareFactoryDir,
  getKairosSoftwareFactoryTenantAppDir,
} from './paths.js'

export const KAIROS_SOFTWARE_FACTORY_VERSION = 1

export type SoftwareFactoryClause = {
  id: string
  text: string
}

export type SoftwareFactorySpec = {
  version: 1
  buildId: string
  appId: string
  tenantId: string
  projectDir: string
  title: string
  sourceBrief: string
  clauses: SoftwareFactoryClause[]
  createdAt: string
}

export type SoftwareFactoryEvalCase = {
  id: string
  clauseId: string
  name: string
  assertion: string
  gates: Array<'traceability' | 'smoke'>
}

export type SoftwareFactoryEvalPack = {
  version: 1
  buildId: string
  appId: string
  generatedAt: string
  cases: SoftwareFactoryEvalCase[]
}

export type SoftwareFactoryReviewVerdict = {
  clauseId: string
  status: 'satisfied' | 'missing'
  evidence: string[]
}

export type SoftwareFactoryReview = {
  version: 1
  buildId: string
  reviewer: 'deterministic-traceability-reviewer'
  status: 'passed' | 'blocked'
  verdicts: SoftwareFactoryReviewVerdict[]
  reviewedAt: string
}

export type SoftwareFactorySmokeCheck = {
  id: string
  status: 'passed' | 'failed'
  detail: string
}

export type SoftwareFactorySmokeResult = {
  version: 1
  buildId: string
  status: 'passed' | 'failed'
  checks: SoftwareFactorySmokeCheck[]
  completedAt: string
}

export type SoftwareFactoryAppManifest = {
  version: 1
  buildId: string
  appId: string
  tenantId: string
  projectDir: string
  appDir: string
  files: string[]
  traceability: Array<{
    clauseId: string
    file: string
    marker: string
  }>
  createdAt: string
}

export type SoftwareFactoryAuditEvent = {
  version: 1
  buildId: string
  tenantId: string
  t: string
  kind:
    | 'build.started'
    | 'spec.confirmed'
    | 'eval_pack.generated'
    | 'builder.scaffold_written'
    | 'reviewer.verdict_recorded'
    | 'smoke.completed'
    | 'build.completed'
    | 'code.drift_detected'
    | 'change.proposed'
    | 'change.applied'
    | 'reconciliation.proposed'
    | 'reconciliation.accepted'
  details: Record<string, unknown>
  prevHash: string | null
  hash: string
}

export type RunSoftwareFactoryBuildOptions = {
  projectDir: string
  brief: string
  tenantId?: string
  now?: () => Date
  generateId?: () => string
}

export type SoftwareFactoryBuildResult = {
  buildId: string
  appId: string
  tenantId: string
  title: string
  status: 'succeeded' | 'blocked'
  buildDir: string
  appDir: string
  specPath: string
  projectSpecPath: string
  projectSpecMarkdownPath: string
  evalPackPath: string
  projectEvalPackPath: string
  appManifestPath: string
  reviewPath: string
  smokePath: string
  auditPath: string
  clauseCount: number
}

export type SoftwareFactoryBuildSummary = SoftwareFactoryBuildResult & {
  createdAt: string
}

export type SoftwareFactoryBuildVerification = {
  buildId: string
  ok: boolean
  checks: Array<{
    id: string
    ok: boolean
    detail: string
  }>
}

export type SoftwareFactoryTraceabilityScan = {
  buildId: string
  ok: boolean
  scannedFiles: string[]
  untraceableFiles: string[]
  auditEventAppended: boolean
  auditPath: string
}

export type SoftwareFactoryCompliancePack = {
  version: 1
  buildId: string
  exportedAt: string
  spec: SoftwareFactorySpec
  evalPack: SoftwareFactoryEvalPack
  appManifest: SoftwareFactoryAppManifest
  review: SoftwareFactoryReview
  smoke: SoftwareFactorySmokeResult
  verification: SoftwareFactoryBuildVerification
  auditEvents: SoftwareFactoryAuditEvent[]
  generatedFiles: Array<{
    path: string
    sha256: string
    content: string
  }>
  exportHash: string
}

export type SoftwareFactoryComplianceExport = {
  buildId: string
  exportPath: string
  exportHash: string
  fileCount: number
  auditEventCount: number
  verified: boolean
}

export type SoftwareFactoryReconciliationProposal = {
  version: 1
  buildId: string
  status: 'not_needed' | 'proposed'
  proposedAt: string
  deltas: Array<{
    id: string
    sourceFile: string
    proposedClauseText: string
    reason: string
  }>
}

export type SoftwareFactoryReconciliationResult = {
  buildId: string
  status: 'not_needed' | 'proposed'
  proposalPath: string
  deltaCount: number
  auditEventAppended: boolean
}

export type SoftwareFactoryReconciliationAcceptResult = {
  buildId: string
  accepted: boolean
  acceptedClauseIds: string[]
  specPath: string
  evalPackPath: string
  projectEvalPackPath: string
  auditEventAppended: boolean
}

export type SoftwareFactoryChangeProposal = {
  version: 1
  buildId: string
  status: 'proposed'
  proposedAt: string
  changeText: string
  proposedClause: SoftwareFactoryClause
  generatedFile: {
    path: string
    content: string
  }
}

export type SoftwareFactoryChangeProposalResult = {
  buildId: string
  proposalPath: string
  proposedClauseId: string
  generatedFilePath: string
  auditEventAppended: boolean
}

export type SoftwareFactoryChangeAcceptResult = {
  buildId: string
  accepted: boolean
  acceptedClauseId: string | null
  generatedFilePath: string | null
  specPath: string
  evalPackPath: string
  projectEvalPackPath: string
  auditEventAppended: boolean
}

const SOFTWARE_FACTORY_BUILD_ID_PATTERN = /^sf-[A-Za-z0-9][A-Za-z0-9-]{0,80}$/

function sortForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForHash)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortForHash(entryValue)]),
    )
  }
  return value
}

function hashJson(value: unknown): string {
  return createHash('sha256')
    .update(jsonStringify(sortForHash(value)))
    .digest('hex')
}

function assertValidSoftwareFactoryBuildId(buildId: string): void {
  if (!SOFTWARE_FACTORY_BUILD_ID_PATTERN.test(buildId)) {
    throw new Error(`Invalid Software Factory build ID: ${buildId}`)
  }
}

function getBuildPaths(buildId: string): {
  buildDir: string
  specPath: string
  evalPackPath: string
  appManifestPath: string
  reviewPath: string
  smokePath: string
  auditPath: string
} {
  assertValidSoftwareFactoryBuildId(buildId)
  const buildDir = getKairosSoftwareFactoryBuildDir(buildId)
  return {
    buildDir,
    specPath: join(buildDir, 'spec.json'),
    evalPackPath: join(buildDir, 'eval-pack.json'),
    appManifestPath: join(buildDir, 'app-manifest.json'),
    reviewPath: join(buildDir, 'review.json'),
    smokePath: join(buildDir, 'smoke.json'),
    auditPath: join(buildDir, 'audit.jsonl'),
  }
}

function getProjectEvalPackPath(projectDir: string, buildId: string): string {
  return join(projectDir, 'evals', 'software-factory', buildId, 'eval-pack.json')
}

function getProjectSpecPath(projectDir: string, buildId: string): string {
  return join(projectDir, '.kairos', 'specs', buildId, 'spec.json')
}

function getProjectSpecMarkdownPath(projectDir: string, buildId: string): string {
  return join(projectDir, '.kairos', 'specs', buildId, 'spec.md')
}

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw) as T
}

async function readAuditEvents(path: string): Promise<SoftwareFactoryAuditEvent[]> {
  const raw = await readFile(path, 'utf8')
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as SoftwareFactoryAuditEvent)
}

async function listSourceFilesRecursive(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const files: string[] = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue
    }
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listSourceFilesRecursive(path)))
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(path)
    }
  }
  return files.sort()
}

async function findUntraceableSourceFiles(
  appDir: string,
): Promise<{ sourceFiles: string[]; untraceableFiles: string[] }> {
  const sourceFiles = await listSourceFilesRecursive(appDir)
  const untraceableFiles = (
    await Promise.all(
      sourceFiles.map(async file => {
        const source = await readFile(file, 'utf8')
        return source.includes('kairos:clause=') ? null : file
      }),
    )
  ).filter((file): file is string => file !== null)
  return { sourceFiles, untraceableFiles }
}

function verifyAuditChain(events: SoftwareFactoryAuditEvent[]): {
  ok: boolean
  detail: string
} {
  let previousHash: string | null = null
  for (const [index, event] of events.entries()) {
    const eventNumber = index + 1
    if (event.prevHash !== previousHash) {
      return {
        ok: false,
        detail: `event ${eventNumber} prevHash mismatch`,
      }
    }
    const { hash, ...hashMaterial } = event
    const expectedHash = hashJson(hashMaterial)
    if (hash !== expectedHash) {
      return {
        ok: false,
        detail: `event ${eventNumber} hash mismatch`,
      }
    }
    previousHash = hash
  }
  return {
    ok: events.length > 0,
    detail: `${events.length} audit event(s) verified`,
  }
}

function toBuildSummary(
  spec: SoftwareFactorySpec,
  smoke: SoftwareFactorySmokeResult,
  paths: ReturnType<typeof getBuildPaths>,
): SoftwareFactoryBuildSummary {
  return {
    buildId: spec.buildId,
    appId: spec.appId,
    tenantId: spec.tenantId,
    title: spec.title,
    status: smoke.status === 'passed' ? 'succeeded' : 'blocked',
    buildDir: paths.buildDir,
    appDir: getKairosSoftwareFactoryTenantAppDir(spec.tenantId, spec.appId),
    specPath: paths.specPath,
    projectSpecPath: getProjectSpecPath(spec.projectDir, spec.buildId),
    projectSpecMarkdownPath: getProjectSpecMarkdownPath(
      spec.projectDir,
      spec.buildId,
    ),
    evalPackPath: paths.evalPackPath,
    projectEvalPackPath: getProjectEvalPackPath(spec.projectDir, spec.buildId),
    appManifestPath: paths.appManifestPath,
    reviewPath: paths.reviewPath,
    smokePath: paths.smokePath,
    auditPath: paths.auditPath,
    clauseCount: spec.clauses.length,
    createdAt: spec.createdAt,
  }
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'generated-app'
}

function titleFromBrief(brief: string): string {
  const firstSentence =
    brief.trim().split(/[.!?\n]/)[0]?.trim() ?? brief.trim()
  const words = firstSentence
    .replace(/[^A-Za-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      word =>
        !['build', 'create', 'make', 'an', 'a', 'the'].includes(
          word.toLowerCase(),
        ),
    )
    .slice(0, 6)
  if (words.length === 0) return 'Generated Workflow App'
  return words
    .map(
      word =>
        `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`,
    )
    .join(' ')
}

export function extractSoftwareFactoryClauses(
  brief: string,
): SoftwareFactoryClause[] {
  const userClauses = brief
    .split(/[\n.;]+/)
    .map(clause => clause.trim())
    .filter(Boolean)
    .slice(0, 8)

  const clauses = [...userClauses]
  if (clauses.length < 2) {
    clauses.push('Persist submitted records and show them in a list view')
  }
  if (!clauses.some(clause => /audit|review|approve|status/i.test(clause))) {
    clauses.push('Record important status changes in an audit trail')
  }
  if (
    !clauses.some(clause =>
      /role|auth|permission|manager|approver/i.test(clause),
    )
  ) {
    clauses.push('Guard reviewer actions behind explicit role checks')
  }

  return clauses.map((text, index) => ({
    id: `CL-${String(index + 1).padStart(3, '0')}`,
    text,
  }))
}

function createEvalPack(
  spec: SoftwareFactorySpec,
  generatedAt: string,
): SoftwareFactoryEvalPack {
  return {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId: spec.buildId,
    appId: spec.appId,
    generatedAt,
    cases: spec.clauses.map(clause => ({
      id: `EV-${clause.id.slice(3)}`,
      clauseId: clause.id,
      name: `Clause ${clause.id} is traceable and smoke-gated`,
      assertion:
        `Generated code must include kairos:clause=${clause.id} ` +
        'and the smoke gate must pass before acceptance.',
      gates: ['traceability', 'smoke'],
    })),
  }
}

function renderSpecMarkdown(spec: SoftwareFactorySpec): string {
  return [
    `# ${spec.title}`,
    '',
    `Build ID: ${spec.buildId}`,
    `App ID: ${spec.appId}`,
    `Tenant: ${spec.tenantId}`,
    '',
    '## Source Brief',
    '',
    spec.sourceBrief,
    '',
    '## Clauses',
    '',
    ...spec.clauses.map(clause => `- ${clause.id}: ${clause.text}`),
    '',
  ].join('\n')
}

function nextClauseId(spec: SoftwareFactorySpec, offset: number): string {
  const maxClauseNumber = Math.max(
    0,
    ...spec.clauses.map(clause => {
      const parsed = Number(clause.id.replace(/^CL-/, ''))
      return Number.isFinite(parsed) ? parsed : 0
    }),
  )
  return `CL-${String(maxClauseNumber + offset).padStart(3, '0')}`
}

function renderChangeFile(clause: SoftwareFactoryClause, changeText: string): string {
  return `// kairos:clause=${clause.id} accepted change proposal

export type ChangeProposal = {
  clauseId: string
  summary: string
}

export function describeChange(): ChangeProposal {
  return {
    clauseId: '${clause.id}',
    summary: ${JSON.stringify(changeText.trim())},
  }
}
`
}

function changeFilePath(clause: SoftwareFactoryClause, changeText: string): string {
  return join(
    'src',
    `change-${clause.id.toLowerCase()}-${slugify(changeText).slice(0, 24)}.ts`,
  )
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return char
    }
  })
}

async function rewriteSpecAndEvalPacks(
  spec: SoftwareFactorySpec,
  buildId: string,
  paths: ReturnType<typeof getBuildPaths>,
  generatedAt: string,
): Promise<string> {
  const specMarkdown = renderSpecMarkdown(spec)
  await writeJson(paths.specPath, spec)
  await writeText(join(paths.buildDir, 'spec.md'), specMarkdown)
  await writeJson(getProjectSpecPath(spec.projectDir, buildId), spec)
  await writeText(getProjectSpecMarkdownPath(spec.projectDir, buildId), specMarkdown)
  const evalPack = createEvalPack(spec, generatedAt)
  const projectEvalPackPath = getProjectEvalPackPath(spec.projectDir, buildId)
  await writeJson(paths.evalPackPath, evalPack)
  await writeJson(projectEvalPackPath, evalPack)
  return projectEvalPackPath
}

function renderPackageJson(appId: string): string {
  return `${jsonStringify(
    {
      name: appId,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        start: 'bun ./src/server.ts',
        smoke: 'bun ./src/server.ts --smoke',
      },
    },
    null,
    2,
  )}\n`
}

function renderServer(spec: SoftwareFactorySpec): string {
  const markers = spec.clauses
    .map(clause => `// kairos:clause=${clause.id} ${clause.text}`)
    .join('\n')
  return `import { renderAppShell } from './app.js'
import { canReview, recordAuditEvent } from './policies.js'

${markers}

type RecordState = {
  id: string
  title: string
  status: 'pending' | 'approved' | 'rejected'
}

const records: RecordState[] = []

export function createRecord(title: string): RecordState {
  if (!title.trim()) {
    throw new Error('title is required')
  }
  const record = { id: crypto.randomUUID(), title: title.trim(), status: 'pending' as const }
  records.push(record)
  recordAuditEvent('record.created', record.id)
  return record
}

export function reviewRecord(id: string, decision: 'approved' | 'rejected', role: string): RecordState {
  if (!canReview(role)) {
    throw new Error('reviewer role required')
  }
  const record = records.find(entry => entry.id === id)
  if (!record) {
    throw new Error('record not found')
  }
  record.status = decision
  recordAuditEvent(\`record.\${decision}\`, record.id)
  return record
}

if (process.argv.includes('--smoke')) {
  const record = createRecord('smoke record')
  reviewRecord(record.id, 'approved', 'reviewer')
  console.log(renderAppShell(records))
}
`
}

function renderApp(spec: SoftwareFactorySpec): string {
  const clauseList = spec.clauses
    .map(
      clause =>
        `      <li><code>${escapeHtml(clause.id)}</code> ${escapeHtml(clause.text)}</li>`,
    )
    .join('\n')
  const escapedTitle = escapeHtml(spec.title)
  return `// kairos:clause=${spec.clauses[0]?.id ?? 'CL-001'} primary app shell

type RecordState = {
  id: string
  title: string
  status: string
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return char
    }
  })
}

export function renderAppShell(records: RecordState[]): string {
  return \`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapedTitle}</title>
  </head>
  <body>
    <main>
      <h1>${escapedTitle}</h1>
      <section aria-label="Traceability clauses">
        <h2>Spec Clauses</h2>
        <ul>
${clauseList}
        </ul>
      </section>
      <section aria-label="Records">
        <h2>Records</h2>
        <pre>\${escapeHtml(JSON.stringify(records, null, 2))}</pre>
      </section>
    </main>
  </body>
</html>\`
}
`
}

function renderPolicies(spec: SoftwareFactorySpec): string {
  const markers = spec.clauses
    .filter(clause =>
      /audit|review|approve|status|role|auth|permission|manager|approver/i.test(
        clause.text,
      ),
    )
    .map(clause => `// kairos:clause=${clause.id} policy guard`)
    .join('\n')
  return `${markers || `// kairos:clause=${spec.clauses[0]?.id ?? 'CL-001'} policy guard`}

const auditEvents: Array<{ kind: string; recordId: string; t: string }> = []

export function canReview(role: string): boolean {
  return role === 'reviewer' || role === 'admin'
}

export function recordAuditEvent(kind: string, recordId: string): void {
  auditEvents.push({ kind, recordId, t: new Date().toISOString() })
}

export function listAuditEvents(): Array<{ kind: string; recordId: string; t: string }> {
  return [...auditEvents]
}
`
}

function renderReadme(spec: SoftwareFactorySpec): string {
  return [
    `# ${spec.title}`,
    '',
    'Generated by `kairos build run` as a traceable v1 workflow scaffold.',
    '',
    '## Traceability',
    '',
    ...spec.clauses.map(clause => `- ${clause.id}: \`kairos:clause=${clause.id}\``),
    '',
  ].join('\n')
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${jsonStringify(value, null, 2)}\n`, 'utf8')
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value, 'utf8')
}

async function appendAuditEvent(
  auditPath: string,
  events: SoftwareFactoryAuditEvent[],
  event: Omit<SoftwareFactoryAuditEvent, 'prevHash' | 'hash'>,
): Promise<SoftwareFactoryAuditEvent> {
  const details = {
    ...event.details,
    prompt_sha: hashJson({
      buildId: event.buildId,
      kind: event.kind,
      details: event.details,
    }),
    model_id: 'kairos-deterministic-local-v1',
    cost_usd: 0,
  }
  const eventWithProvenance = { ...event, details }
  const prevHash = events.at(-1)?.hash ?? null
  const hash = hashJson({ ...eventWithProvenance, prevHash })
  const complete = { ...eventWithProvenance, prevHash, hash }
  events.push(complete)
  await writeText(
    auditPath,
    `${events.map(entry => jsonStringify(entry)).join('\n')}\n`,
  )
  return complete
}

export async function readSoftwareFactoryBuild(
  buildId: string,
): Promise<SoftwareFactoryBuildSummary> {
  const paths = getBuildPaths(buildId)
  const spec = await readJson<SoftwareFactorySpec>(paths.specPath)
  const smoke = await readJson<SoftwareFactorySmokeResult>(paths.smokePath)
  return toBuildSummary(spec, smoke, paths)
}

export async function listSoftwareFactoryBuilds(): Promise<
  SoftwareFactoryBuildSummary[]
> {
  const buildsDir = join(getKairosSoftwareFactoryDir(), 'builds')
  let entries: string[]
  try {
    entries = await readdir(buildsDir)
  } catch {
    return []
  }

  const summaries = await Promise.all(
    entries
      .filter(entry => SOFTWARE_FACTORY_BUILD_ID_PATTERN.test(entry))
      .map(async entry => {
        try {
          return await readSoftwareFactoryBuild(entry)
        } catch {
          return null
        }
      }),
  )
  return summaries
    .filter((summary): summary is SoftwareFactoryBuildSummary => summary !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function verifySoftwareFactoryBuild(
  buildId: string,
): Promise<SoftwareFactoryBuildVerification> {
  const checks: SoftwareFactoryBuildVerification['checks'] = []
  const addCheck = (id: string, ok: boolean, detail: string): void => {
    checks.push({ id, ok, detail })
  }

  const paths = getBuildPaths(buildId)
  try {
    const [spec, evalPack, manifest, review, smoke, auditEvents] =
      await Promise.all([
        readJson<SoftwareFactorySpec>(paths.specPath),
        readJson<SoftwareFactoryEvalPack>(paths.evalPackPath),
        readJson<SoftwareFactoryAppManifest>(paths.appManifestPath),
        readJson<SoftwareFactoryReview>(paths.reviewPath),
        readJson<SoftwareFactorySmokeResult>(paths.smokePath),
        readAuditEvents(paths.auditPath),
      ])
    let projectSpec: SoftwareFactorySpec | null = null
    let projectSpecMarkdown: string | null = null
    let projectEvalPack: SoftwareFactoryEvalPack | null = null
    const projectSpecPath = getProjectSpecPath(spec.projectDir, spec.buildId)
    const projectSpecMarkdownPath = getProjectSpecMarkdownPath(
      spec.projectDir,
      spec.buildId,
    )
    try {
      projectSpec = await readJson<SoftwareFactorySpec>(projectSpecPath)
      projectSpecMarkdown = await readFile(projectSpecMarkdownPath, 'utf8')
    } catch {
      projectSpec = null
      projectSpecMarkdown = null
    }
    try {
      projectEvalPack = await readJson<SoftwareFactoryEvalPack>(
        getProjectEvalPackPath(spec.projectDir, spec.buildId),
      )
    } catch {
      projectEvalPack = null
    }

    const artifactBuildIds = [
      spec.buildId,
      evalPack.buildId,
      manifest.buildId,
      review.buildId,
      smoke.buildId,
    ]
    addCheck(
      'artifact-build-ids',
      artifactBuildIds.every(id => id === buildId),
      `${artifactBuildIds.filter(id => id === buildId).length}/${artifactBuildIds.length} artifact(s) match ${buildId}`,
    )

    const clauseIds = new Set(spec.clauses.map(clause => clause.id))
    const evalClauseIds = new Set(evalPack.cases.map(testCase => testCase.clauseId))
    const allClausesHaveEval = [...clauseIds].every(clauseId =>
      evalClauseIds.has(clauseId),
    )
    const allEvalCasesGateTraceability = evalPack.cases.every(
      testCase =>
        testCase.gates.includes('traceability') &&
        testCase.gates.includes('smoke'),
    )
    addCheck(
      'eval-pack',
      allClausesHaveEval && allEvalCasesGateTraceability,
      `${evalPack.cases.length}/${spec.clauses.length} eval case(s) generated with traceability and smoke gates`,
    )
    const safeManifestFiles = manifest.files.map(file => {
      try {
        assertSafeAppRelativePath(file)
        return true
      } catch {
        return false
      }
    })
    addCheck(
      'manifest-files',
      safeManifestFiles.every(Boolean),
      `${safeManifestFiles.filter(Boolean).length}/${safeManifestFiles.length} manifest file path(s) safe`,
    )
    addCheck(
      'project-spec',
      projectSpec?.buildId === spec.buildId &&
        projectSpec.appId === spec.appId &&
        projectSpec.clauses.length === spec.clauses.length &&
        spec.clauses.every((clause, index) => {
          const projectClause = projectSpec?.clauses[index]
          return (
            projectClause?.id === clause.id &&
            projectClause.text === clause.text
          )
        }) &&
        projectSpecMarkdown?.includes(spec.buildId) === true,
      projectSpec
        ? `repo-local spec at ${projectSpecPath}`
        : 'repo-local spec missing',
    )
    addCheck(
      'project-eval-pack',
      projectEvalPack?.buildId === spec.buildId &&
        projectEvalPack.appId === spec.appId &&
        projectEvalPack.cases.length === evalPack.cases.length &&
        evalPack.cases.every((testCase, index) => {
          const projectCase = projectEvalPack?.cases[index]
          return (
            projectCase?.id === testCase.id &&
            projectCase.clauseId === testCase.clauseId &&
            projectCase.assertion === testCase.assertion &&
            projectCase.gates.length === testCase.gates.length &&
            testCase.gates.every(gate => projectCase.gates.includes(gate))
          )
        }),
      projectEvalPack
        ? `${projectEvalPack.cases.length}/${evalPack.cases.length} repo eval case(s) written`
        : 'repo eval pack missing',
    )

    const traceClauseIds = new Set(
      manifest.traceability.map(trace => trace.clauseId),
    )
    addCheck(
      'manifest-traceability',
      [...clauseIds].every(clauseId => traceClauseIds.has(clauseId)),
      `${traceClauseIds.size}/${clauseIds.size} clause(s) recorded in app manifest`,
    )

    const markerChecks = await Promise.all(
      manifest.traceability.map(async trace => {
        try {
          const sourceFile = assertSafeGeneratedSourcePath(trace.file)
          const source = await readFile(join(manifest.appDir, sourceFile), 'utf8')
          return source.includes(trace.marker)
        } catch {
          return false
        }
      }),
    )
    addCheck(
      'code-markers',
      markerChecks.every(Boolean) && markerChecks.length >= clauseIds.size,
      `${markerChecks.filter(Boolean).length}/${markerChecks.length} trace marker(s) found in generated code`,
    )

    const { sourceFiles, untraceableFiles } =
      await findUntraceableSourceFiles(manifest.appDir)
    addCheck(
      'untraceable-code',
      untraceableFiles.length === 0,
      untraceableFiles.length === 0
        ? `${sourceFiles.length} source file(s) traceable`
        : `${untraceableFiles.length}/${sourceFiles.length} source file(s) missing kairos:clause markers`,
    )

    addCheck(
      'review',
      review.status === 'passed' &&
        review.verdicts.every(verdict => verdict.status === 'satisfied'),
      `${review.verdicts.filter(verdict => verdict.status === 'satisfied').length}/${review.verdicts.length} reviewer verdict(s) satisfied`,
    )

    addCheck(
      'smoke',
      smoke.status === 'passed' &&
        smoke.checks.every(check => check.status === 'passed'),
      `${smoke.checks.filter(check => check.status === 'passed').length}/${smoke.checks.length} smoke check(s) passed`,
    )

    const audit = verifyAuditChain(auditEvents)
    addCheck('audit-chain', audit.ok, audit.detail)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    addCheck('artifacts-readable', false, message)
  }

  return {
    buildId,
    ok: checks.length > 0 && checks.every(check => check.ok),
    checks,
  }
}

export async function scanSoftwareFactoryTraceability(
  buildId: string,
  options: { now?: () => Date } = {},
): Promise<SoftwareFactoryTraceabilityScan> {
  const paths = getBuildPaths(buildId)
  const manifest = await readJson<SoftwareFactoryAppManifest>(
    paths.appManifestPath,
  )
  const { sourceFiles, untraceableFiles } =
    await findUntraceableSourceFiles(manifest.appDir)

  let auditEventAppended = false
  if (untraceableFiles.length > 0) {
    const events = await readAuditEvents(paths.auditPath)
    const audit = verifyAuditChain(events)
    if (!audit.ok) {
      throw new Error(`Cannot append drift event: ${audit.detail}`)
    }
    await appendAuditEvent(paths.auditPath, events, {
      version: KAIROS_SOFTWARE_FACTORY_VERSION,
      buildId,
      tenantId: manifest.tenantId,
      t: (options.now ?? (() => new Date()))().toISOString(),
      kind: 'code.drift_detected',
      details: {
        appDir: manifest.appDir,
        untraceableFiles: untraceableFiles.map(file =>
          relative(manifest.appDir, file),
        ),
      },
    })
    auditEventAppended = true
  }

  return {
    buildId,
    ok: untraceableFiles.length === 0,
    scannedFiles: sourceFiles.map(file => relative(manifest.appDir, file)),
    untraceableFiles: untraceableFiles.map(file =>
      relative(manifest.appDir, file),
    ),
    auditEventAppended,
    auditPath: paths.auditPath,
  }
}

function humanizeSourceFile(file: string): string {
  return file
    .replace(/^src\//, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, match => match.toUpperCase())
}

function assertProposalBuildId(
  proposal: { buildId: string },
  buildId: string,
  kind: string,
): void {
  if (proposal.buildId !== buildId) {
    throw new Error(
      `Cannot accept ${kind} proposal for ${proposal.buildId} in build ${buildId}`,
    )
  }
}

function assertSafeAppRelativePath(path: string): string {
  const normalized = normalize(path)
  if (
    path.includes('\0') ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) ||
    normalized === '.' ||
    normalized.split(/[\\/]+/).includes('..')
  ) {
    throw new Error(`Unsafe Software Factory app-relative path: ${path}`)
  }
  return normalized
}

function assertSafeGeneratedSourcePath(path: string): string {
  const normalized = assertSafeAppRelativePath(path)
  if (!/^src[\\/].+\.(ts|tsx|js|jsx)$/.test(normalized)) {
    throw new Error(`Unsafe Software Factory generated source path: ${path}`)
  }
  return normalized
}

export async function proposeSoftwareFactoryReconciliation(
  buildId: string,
  options: { now?: () => Date } = {},
): Promise<SoftwareFactoryReconciliationResult> {
  const paths = getBuildPaths(buildId)
  const manifest = await readJson<SoftwareFactoryAppManifest>(
    paths.appManifestPath,
  )
  const { untraceableFiles } = await findUntraceableSourceFiles(manifest.appDir)
  const proposedAt = (options.now ?? (() => new Date()))().toISOString()
  const proposal: SoftwareFactoryReconciliationProposal = {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId,
    status: untraceableFiles.length === 0 ? 'not_needed' : 'proposed',
    proposedAt,
    deltas: untraceableFiles.map((file, index) => {
      const sourceFile = relative(manifest.appDir, file)
      return {
        id: `REC-${String(index + 1).padStart(3, '0')}`,
        sourceFile,
        proposedClauseText: `Account for ${humanizeSourceFile(sourceFile)} behavior in the confirmed spec or remove the untraceable code.`,
        reason:
          'Generated source file is missing a kairos:clause marker and cannot be traced to an approved spec clause.',
      }
    }),
  }
  const proposalPath = join(paths.buildDir, 'reconciliation-proposal.json')
  await writeJson(proposalPath, proposal)

  let auditEventAppended = false
  if (proposal.status === 'proposed') {
    const events = await readAuditEvents(paths.auditPath)
    const audit = verifyAuditChain(events)
    if (!audit.ok) {
      throw new Error(`Cannot append reconciliation event: ${audit.detail}`)
    }
    await appendAuditEvent(paths.auditPath, events, {
      version: KAIROS_SOFTWARE_FACTORY_VERSION,
      buildId,
      tenantId: manifest.tenantId,
      t: proposedAt,
      kind: 'reconciliation.proposed',
      details: {
        proposalPath,
        deltaCount: proposal.deltas.length,
        sourceFiles: proposal.deltas.map(delta => delta.sourceFile),
      },
    })
    auditEventAppended = true
  }

  return {
    buildId,
    status: proposal.status,
    proposalPath,
    deltaCount: proposal.deltas.length,
    auditEventAppended,
  }
}

export async function acceptSoftwareFactoryReconciliation(
  buildId: string,
  options: { now?: () => Date } = {},
): Promise<SoftwareFactoryReconciliationAcceptResult> {
  const paths = getBuildPaths(buildId)
  const [spec, manifest, review, proposal] = await Promise.all([
    readJson<SoftwareFactorySpec>(paths.specPath),
    readJson<SoftwareFactoryAppManifest>(paths.appManifestPath),
    readJson<SoftwareFactoryReview>(paths.reviewPath),
    readJson<SoftwareFactoryReconciliationProposal>(
      join(paths.buildDir, 'reconciliation-proposal.json'),
    ),
  ])
  assertProposalBuildId(proposal, buildId, 'reconciliation')

  if (proposal.status !== 'proposed' || proposal.deltas.length === 0) {
    return {
      buildId,
      accepted: false,
      acceptedClauseIds: [],
      specPath: paths.specPath,
      evalPackPath: paths.evalPackPath,
      projectEvalPackPath: getProjectEvalPackPath(spec.projectDir, buildId),
      auditEventAppended: false,
    }
  }

  const acceptedClauses = proposal.deltas.map((delta, index) => ({
    id: nextClauseId(spec, index + 1),
    text: delta.proposedClauseText,
  }))
  const revisedSpec: SoftwareFactorySpec = {
    ...spec,
    clauses: [...spec.clauses, ...acceptedClauses],
  }
  const projectEvalPackPath = await rewriteSpecAndEvalPacks(
    revisedSpec,
    buildId,
    paths,
    (options.now ?? (() => new Date()))().toISOString(),
  )

  const revisedTraceability = [...manifest.traceability]
  for (const [index, delta] of proposal.deltas.entries()) {
    const clause = acceptedClauses[index] as SoftwareFactoryClause
    const sourceFile = assertSafeGeneratedSourcePath(delta.sourceFile)
    const absoluteFile = join(manifest.appDir, sourceFile)
    const source = await readFile(absoluteFile, 'utf8')
    if (!source.includes(`kairos:clause=${clause.id}`)) {
      await writeFile(
        absoluteFile,
        `// kairos:clause=${clause.id} accepted reconciliation: ${delta.proposedClauseText}\n${source}`,
        'utf8',
      )
    }
    revisedTraceability.push({
      clauseId: clause.id,
      file: sourceFile,
      marker: `kairos:clause=${clause.id}`,
    })
  }

  const revisedManifest: SoftwareFactoryAppManifest = {
    ...manifest,
    traceability: revisedTraceability,
  }
  await writeJson(paths.appManifestPath, revisedManifest)

  const revisedReview: SoftwareFactoryReview = {
    ...review,
    verdicts: [
      ...review.verdicts,
      ...acceptedClauses.map((clause, index) => ({
        clauseId: clause.id,
        status: 'satisfied' as const,
        evidence: [join(manifest.appDir, proposal.deltas[index]?.sourceFile ?? '')],
      })),
    ],
    reviewedAt: (options.now ?? (() => new Date()))().toISOString(),
  }
  await writeJson(paths.reviewPath, revisedReview)

  const events = await readAuditEvents(paths.auditPath)
  const audit = verifyAuditChain(events)
  if (!audit.ok) {
    throw new Error(`Cannot append reconciliation acceptance: ${audit.detail}`)
  }
  await appendAuditEvent(paths.auditPath, events, {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId,
    tenantId: manifest.tenantId,
    t: (options.now ?? (() => new Date()))().toISOString(),
    kind: 'reconciliation.accepted',
    details: {
      acceptedClauseIds: acceptedClauses.map(clause => clause.id),
      proposalPath: join(paths.buildDir, 'reconciliation-proposal.json'),
    },
  })

  return {
    buildId,
    accepted: true,
    acceptedClauseIds: acceptedClauses.map(clause => clause.id),
    specPath: paths.specPath,
    evalPackPath: paths.evalPackPath,
    projectEvalPackPath,
    auditEventAppended: true,
  }
}

export async function proposeSoftwareFactoryChange(
  buildId: string,
  changeText: string,
  options: { now?: () => Date } = {},
): Promise<SoftwareFactoryChangeProposalResult> {
  const trimmedChange = changeText.trim()
  if (!trimmedChange) {
    throw new Error('Software Factory change text is required')
  }

  const paths = getBuildPaths(buildId)
  const [spec, manifest] = await Promise.all([
    readJson<SoftwareFactorySpec>(paths.specPath),
    readJson<SoftwareFactoryAppManifest>(paths.appManifestPath),
  ])
  const proposedClause: SoftwareFactoryClause = {
    id: nextClauseId(spec, 1),
    text: trimmedChange,
  }
  const generatedFile = {
    path: changeFilePath(proposedClause, trimmedChange),
    content: renderChangeFile(proposedClause, trimmedChange),
  }
  const proposedAt = (options.now ?? (() => new Date()))().toISOString()
  const proposal: SoftwareFactoryChangeProposal = {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId,
    status: 'proposed',
    proposedAt,
    changeText: trimmedChange,
    proposedClause,
    generatedFile,
  }
  const proposalPath = join(paths.buildDir, 'change-proposal.json')
  await writeJson(proposalPath, proposal)

  const events = await readAuditEvents(paths.auditPath)
  const audit = verifyAuditChain(events)
  if (!audit.ok) {
    throw new Error(`Cannot append change proposal event: ${audit.detail}`)
  }
  await appendAuditEvent(paths.auditPath, events, {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId,
    tenantId: manifest.tenantId,
    t: proposedAt,
    kind: 'change.proposed',
    details: {
      proposalPath,
      proposedClauseId: proposedClause.id,
      generatedFilePath: generatedFile.path,
    },
  })

  return {
    buildId,
    proposalPath,
    proposedClauseId: proposedClause.id,
    generatedFilePath: generatedFile.path,
    auditEventAppended: true,
  }
}

export async function acceptSoftwareFactoryChange(
  buildId: string,
  options: { now?: () => Date } = {},
): Promise<SoftwareFactoryChangeAcceptResult> {
  const paths = getBuildPaths(buildId)
  const [spec, manifest, review, proposal] = await Promise.all([
    readJson<SoftwareFactorySpec>(paths.specPath),
    readJson<SoftwareFactoryAppManifest>(paths.appManifestPath),
    readJson<SoftwareFactoryReview>(paths.reviewPath),
    readJson<SoftwareFactoryChangeProposal>(
      join(paths.buildDir, 'change-proposal.json'),
    ),
  ])
  assertProposalBuildId(proposal, buildId, 'change')
  const generatedFilePath = assertSafeGeneratedSourcePath(
    proposal.generatedFile.path,
  )
  const expectedMarker = `kairos:clause=${proposal.proposedClause.id}`
  if (!proposal.generatedFile.content.includes(expectedMarker)) {
    throw new Error(
      `Cannot accept change because generated file is missing ${expectedMarker}`,
    )
  }

  const alreadyAccepted = spec.clauses.some(
    clause => clause.id === proposal.proposedClause.id,
  )
  if (alreadyAccepted) {
    return {
      buildId,
      accepted: false,
      acceptedClauseId: null,
      generatedFilePath: null,
      specPath: paths.specPath,
      evalPackPath: paths.evalPackPath,
      projectEvalPackPath: getProjectEvalPackPath(spec.projectDir, buildId),
      auditEventAppended: false,
    }
  }
  const verification = await verifySoftwareFactoryBuild(buildId)
  if (!verification.ok) {
    const failedChecks = verification.checks
      .filter(check => !check.ok)
      .map(check => check.id)
      .join(', ')
    throw new Error(
      `Cannot accept change while build verification is failing: ${failedChecks}`,
    )
  }

  const revisedSpec: SoftwareFactorySpec = {
    ...spec,
    clauses: [...spec.clauses, proposal.proposedClause],
  }
  const generatedAt = (options.now ?? (() => new Date()))().toISOString()
  const projectEvalPackPath = await rewriteSpecAndEvalPacks(
    revisedSpec,
    buildId,
    paths,
    generatedAt,
  )

  await writeText(
    join(manifest.appDir, generatedFilePath),
    proposal.generatedFile.content,
  )

  const revisedManifest: SoftwareFactoryAppManifest = {
    ...manifest,
    files: Array.from(new Set([...manifest.files, generatedFilePath])),
    traceability: [
      ...manifest.traceability,
      {
        clauseId: proposal.proposedClause.id,
        file: generatedFilePath,
        marker: `kairos:clause=${proposal.proposedClause.id}`,
      },
    ],
  }
  await writeJson(paths.appManifestPath, revisedManifest)

  const revisedReview: SoftwareFactoryReview = {
    ...review,
    verdicts: [
      ...review.verdicts,
      {
        clauseId: proposal.proposedClause.id,
        status: 'satisfied',
        evidence: [join(manifest.appDir, generatedFilePath)],
      },
    ],
    reviewedAt: generatedAt,
  }
  await writeJson(paths.reviewPath, revisedReview)

  const events = await readAuditEvents(paths.auditPath)
  const audit = verifyAuditChain(events)
  if (!audit.ok) {
    throw new Error(`Cannot append change acceptance event: ${audit.detail}`)
  }
  await appendAuditEvent(paths.auditPath, events, {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId,
    tenantId: manifest.tenantId,
    t: generatedAt,
    kind: 'change.applied',
    details: {
      acceptedClauseId: proposal.proposedClause.id,
      generatedFilePath,
      proposalPath: join(paths.buildDir, 'change-proposal.json'),
    },
  })

  return {
    buildId,
    accepted: true,
    acceptedClauseId: proposal.proposedClause.id,
    generatedFilePath,
    specPath: paths.specPath,
    evalPackPath: paths.evalPackPath,
    projectEvalPackPath,
    auditEventAppended: true,
  }
}

export async function exportSoftwareFactoryCompliancePack(
  buildId: string,
  options: { now?: () => Date } = {},
): Promise<SoftwareFactoryComplianceExport> {
  const paths = getBuildPaths(buildId)
  const [spec, evalPack, appManifest, review, smoke, auditEvents] =
    await Promise.all([
      readJson<SoftwareFactorySpec>(paths.specPath),
      readJson<SoftwareFactoryEvalPack>(paths.evalPackPath),
      readJson<SoftwareFactoryAppManifest>(paths.appManifestPath),
      readJson<SoftwareFactoryReview>(paths.reviewPath),
      readJson<SoftwareFactorySmokeResult>(paths.smokePath),
      readAuditEvents(paths.auditPath),
    ])
  const verification = await verifySoftwareFactoryBuild(buildId)
  const generatedFiles = await Promise.all(
    appManifest.files.map(async file => {
      const safeFile = assertSafeAppRelativePath(file)
      const content = await readFile(join(appManifest.appDir, safeFile), 'utf8')
      return {
        path: safeFile,
        sha256: createHash('sha256').update(content).digest('hex'),
        content,
      }
    }),
  )
  const packWithoutHash = {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId,
    exportedAt: (options.now ?? (() => new Date()))().toISOString(),
    spec,
    evalPack,
    appManifest,
    review,
    smoke,
    verification,
    auditEvents,
    generatedFiles,
  } satisfies Omit<SoftwareFactoryCompliancePack, 'exportHash'>
  const exportHash = hashJson(packWithoutHash)
  const pack: SoftwareFactoryCompliancePack = {
    ...packWithoutHash,
    exportHash,
  }
  const exportPath = join(paths.buildDir, 'compliance-pack.json')
  await writeJson(exportPath, pack)
  return {
    buildId,
    exportPath,
    exportHash,
    fileCount: generatedFiles.length,
    auditEventCount: auditEvents.length,
    verified: verification.ok,
  }
}

async function writeGeneratedApp(
  spec: SoftwareFactorySpec,
  appDir: string,
): Promise<SoftwareFactoryAppManifest> {
  const files = new Map<string, string>([
    ['package.json', renderPackageJson(spec.appId)],
    ['README.md', renderReadme(spec)],
    [join('src', 'server.ts'), renderServer(spec)],
    [join('src', 'app.ts'), renderApp(spec)],
    [join('src', 'policies.ts'), renderPolicies(spec)],
  ])

  for (const [relativePath, content] of files) {
    await writeText(join(appDir, relativePath), content)
  }

  return {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId: spec.buildId,
    appId: spec.appId,
    tenantId: spec.tenantId,
    projectDir: spec.projectDir,
    appDir,
    files: [...files.keys()],
    traceability: spec.clauses.map(clause => ({
      clauseId: clause.id,
      file: join('src', 'server.ts'),
      marker: `kairos:clause=${clause.id}`,
    })),
    createdAt: spec.createdAt,
  }
}

async function reviewGeneratedApp(
  spec: SoftwareFactorySpec,
  appDir: string,
  reviewedAt: string,
): Promise<SoftwareFactoryReview> {
  const sourceFiles = [
    join(appDir, 'src', 'server.ts'),
    join(appDir, 'src', 'app.ts'),
    join(appDir, 'src', 'policies.ts'),
    join(appDir, 'README.md'),
  ]
  const fileContents = await Promise.all(
    sourceFiles.map(async file => ({
      file,
      text: await readFile(file, 'utf8'),
    })),
  )
  const verdicts = spec.clauses.map(clause => {
    const marker = `kairos:clause=${clause.id}`
    const evidence = fileContents
      .filter(entry => entry.text.includes(marker))
      .map(entry => entry.file)
    return {
      clauseId: clause.id,
      status: evidence.length > 0 ? 'satisfied' as const : 'missing' as const,
      evidence,
    }
  })
  return {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId: spec.buildId,
    reviewer: 'deterministic-traceability-reviewer',
    status: verdicts.every(verdict => verdict.status === 'satisfied')
      ? 'passed'
      : 'blocked',
    verdicts,
    reviewedAt,
  }
}

function smokeGeneratedApp(
  manifest: SoftwareFactoryAppManifest,
  review: SoftwareFactoryReview,
  completedAt: string,
): SoftwareFactorySmokeResult {
  const checks: SoftwareFactorySmokeCheck[] = [
    {
      id: 'files-written',
      status: manifest.files.length >= 5 ? 'passed' : 'failed',
      detail: `${manifest.files.length} generated file(s) recorded`,
    },
    {
      id: 'traceability-review',
      status: review.status === 'passed' ? 'passed' : 'failed',
      detail:
        `${review.verdicts.filter(verdict => verdict.status === 'satisfied').length}` +
        `/${review.verdicts.length} clause marker(s) found`,
    },
    {
      id: 'eval-pack-handoff',
      status: manifest.traceability.length > 0 ? 'passed' : 'failed',
      detail: 'eval pack has clause-level traceability gates',
    },
  ]
  return {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId: manifest.buildId,
    status: checks.every(check => check.status === 'passed')
      ? 'passed'
      : 'failed',
    checks,
    completedAt,
  }
}

export async function runSoftwareFactoryBuild(
  options: RunSoftwareFactoryBuildOptions,
): Promise<SoftwareFactoryBuildResult> {
  const brief = options.brief.trim()
  if (!brief) {
    throw new Error('Software Factory build brief is required')
  }

  const now = options.now ?? (() => new Date())
  const generateId = options.generateId ?? (() => randomUUID().slice(0, 8))
  const createdAt = now().toISOString()
  const title = titleFromBrief(brief)
  const buildId = `sf-${generateId()}`
  const appId = `${slugify(title)}-${generateId()}`
  const tenantId =
    options.tenantId?.trim() ||
    process.env.KAIROS_TENANT_ID?.trim() ||
    'local'
  const buildDir = getKairosSoftwareFactoryBuildDir(buildId)
  const appDir = getKairosSoftwareFactoryTenantAppDir(tenantId, appId)
  const auditPath = join(buildDir, 'audit.jsonl')
  const auditEvents: SoftwareFactoryAuditEvent[] = []

  await mkdir(buildDir, { recursive: true })
  await mkdir(appDir, { recursive: true })
  await appendAuditEvent(auditPath, auditEvents, {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId,
    tenantId,
    t: createdAt,
    kind: 'build.started',
    details: { projectDir: options.projectDir, appId },
  })

  const spec: SoftwareFactorySpec = {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId,
    appId,
    tenantId,
    projectDir: options.projectDir,
    title,
    sourceBrief: brief,
    clauses: extractSoftwareFactoryClauses(brief),
    createdAt,
  }
  const specPath = join(buildDir, 'spec.json')
  const specMarkdownPath = join(buildDir, 'spec.md')
  const projectSpecPath = getProjectSpecPath(options.projectDir, buildId)
  const projectSpecMarkdownPath = getProjectSpecMarkdownPath(
    options.projectDir,
    buildId,
  )
  const specMarkdown = renderSpecMarkdown(spec)
  await writeJson(specPath, spec)
  await writeText(specMarkdownPath, specMarkdown)
  await writeJson(projectSpecPath, spec)
  await writeText(projectSpecMarkdownPath, specMarkdown)
  await appendAuditEvent(auditPath, auditEvents, {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId,
    tenantId,
    t: now().toISOString(),
    kind: 'spec.confirmed',
    details: { clauseCount: spec.clauses.length, specPath },
  })

  const evalPack = createEvalPack(spec, now().toISOString())
  const evalPackPath = join(buildDir, 'eval-pack.json')
  const projectEvalPackPath = getProjectEvalPackPath(options.projectDir, buildId)
  await writeJson(evalPackPath, evalPack)
  await writeJson(projectEvalPackPath, evalPack)
  await appendAuditEvent(auditPath, auditEvents, {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId,
    tenantId,
    t: now().toISOString(),
    kind: 'eval_pack.generated',
    details: { caseCount: evalPack.cases.length, evalPackPath },
  })

  const manifest = await writeGeneratedApp(spec, appDir)
  const appManifestPath = join(buildDir, 'app-manifest.json')
  await writeJson(appManifestPath, manifest)
  await appendAuditEvent(auditPath, auditEvents, {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId,
    tenantId,
    t: now().toISOString(),
    kind: 'builder.scaffold_written',
    details: { appDir, fileCount: manifest.files.length },
  })

  const review = await reviewGeneratedApp(spec, appDir, now().toISOString())
  const reviewPath = join(buildDir, 'review.json')
  await writeJson(reviewPath, review)
  await appendAuditEvent(auditPath, auditEvents, {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId,
    tenantId,
    t: now().toISOString(),
    kind: 'reviewer.verdict_recorded',
    details: { status: review.status },
  })

  const smoke = smokeGeneratedApp(manifest, review, now().toISOString())
  const smokePath = join(buildDir, 'smoke.json')
  await writeJson(smokePath, smoke)
  await appendAuditEvent(auditPath, auditEvents, {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId,
    tenantId,
    t: now().toISOString(),
    kind: 'smoke.completed',
    details: { status: smoke.status },
  })
  await appendAuditEvent(auditPath, auditEvents, {
    version: KAIROS_SOFTWARE_FACTORY_VERSION,
    buildId,
    tenantId,
    t: now().toISOString(),
    kind: 'build.completed',
    details: { status: smoke.status === 'passed' ? 'succeeded' : 'blocked' },
  })

  return {
    buildId,
    appId,
    tenantId,
    title,
    status: smoke.status === 'passed' ? 'succeeded' : 'blocked',
    buildDir,
    appDir,
    specPath,
    projectSpecPath,
    projectSpecMarkdownPath,
    evalPackPath,
    projectEvalPackPath,
    appManifestPath,
    reviewPath,
    smokePath,
    auditPath,
    clauseCount: spec.clauses.length,
  }
}
