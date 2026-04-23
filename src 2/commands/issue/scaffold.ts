export type IssueTemplateKind =
  | 'requirement-definition'
  | 'work-order'
  | 'leaf-build'
  | 'spec-design-doc'
  | 'bug-regression'

export type ParsedIssueCommandArgs = {
  kind: IssueTemplateKind
  title: string
  usedPlaceholderTitle: boolean
}

type IssueTemplateDetails = {
  label: string
  aliases: string[]
  artifactPrefix: 'REQ' | 'DES' | 'WO' | 'BUG'
  stageSummary: string
  transformationRule: string
}

type IssueIdentifierBundle = {
  artifactId: string
  acceptanceBaseId: string
  coverageId: string
}

export type TrunkExpectation = 'trunk-safe' | 'trunk-touch'

export type IssueScaffoldInput = {
  kind: IssueTemplateKind
  title: string
  repository?: string
  generatedAt?: string
  upstreamIds?: string[]
  entryPoints?: string[]
  trunkExpectation?: TrunkExpectation
}

const DEFAULT_KIND: IssueTemplateKind = 'work-order'
const DEFAULT_TITLE = 'TODO: concise, outcome-focused issue title'
const STOP_WORDS = new Set([
  'A',
  'AN',
  'AND',
  'FOR',
  'FROM',
  'HOW',
  'IN',
  'INTO',
  'OF',
  'ON',
  'OR',
  'THE',
  'THIS',
  'THAT',
  'TO',
  'WITH',
])

const ISSUE_TEMPLATE_DETAILS: Record<IssueTemplateKind, IssueTemplateDetails> = {
  'requirement-definition': {
    label: 'requirement definition',
    aliases: ['requirement', 'requirements', 'req', 'frd'],
    artifactPrefix: 'REQ',
    stageSummary:
      'Define one cohesive, testable capability before design and implementation.',
    transformationRule:
      'Write the requirement in user and system terms. Downstream design and work-order artifacts should preserve this ID and inherit the acceptance criteria verbatim.',
  },
  'work-order': {
    label: 'work order',
    aliases: ['work-order', 'workorder', 'wo'],
    artifactPrefix: 'WO',
    stageSummary:
      'Translate approved requirements and design into the smallest independently shippable implementation slice.',
    transformationRule:
      'Preserve upstream REQ, AC, and DES IDs verbatim. Do not renumber or reinterpret upstream constraints inside the execution plan.',
  },
  'leaf-build': {
    label: 'leaf build / work order',
    aliases: ['leaf', 'leaf-build', 'build'],
    artifactPrefix: 'WO',
    stageSummary:
      'Focused implementation slice that should be independently shippable.',
    transformationRule:
      'Preserve upstream REQ, AC, and DES IDs verbatim. Keep the slice trunk-safe unless a trunk-touch dependency is unavoidable.',
  },
  'spec-design-doc': {
    label: 'spec / design doc',
    aliases: ['spec', 'design', 'spec-design-doc'],
    artifactPrefix: 'DES',
    stageSummary:
      'Define the intended approach before implementation crosses multiple moving parts.',
    transformationRule:
      'Copy upstream requirement IDs verbatim and map each design decision back to them. The resulting work order should inherit those same IDs without reinterpretation.',
  },
  'bug-regression': {
    label: 'bug / regression',
    aliases: ['bug', 'regression', 'bug-regression'],
    artifactPrefix: 'BUG',
    stageSummary:
      'Capture a concrete failure mode with enough detail to reproduce, scope, and verify the fix.',
    transformationRule:
      'Keep the repro, actual behavior, expected behavior, and verification steps stable across all follow-up design or implementation artifacts.',
  },
}

export function parseIssueKindToken(
  rawKind: string,
): IssueTemplateKind | null {
  const normalized = rawKind.trim().toLowerCase()
  if (!normalized) return null

  for (const [kind, details] of Object.entries(ISSUE_TEMPLATE_DETAILS) as Array<
    [IssueTemplateKind, (typeof ISSUE_TEMPLATE_DETAILS)[IssueTemplateKind]]
  >) {
    if (details.aliases.includes(normalized)) {
      return kind
    }
  }

  return null
}

export function parseIssueCommandArgs(args: string): ParsedIssueCommandArgs | null {
  let remaining = args.trim()
  let kind = DEFAULT_KIND

  const typeFlagMatch = remaining.match(/^--type(?:=|\s+)(\S+)(?:\s+|$)/)
  if (typeFlagMatch) {
    const parsedKind = parseIssueKindToken(typeFlagMatch[1])
    if (parsedKind) {
      kind = parsedKind
      remaining = remaining.slice(typeFlagMatch[0].length).trim()
    } else {
      return null
    }
  } else if (remaining.length > 0) {
    const [firstToken] = remaining.split(/\s+/, 1)
    const parsedKind = parseIssueKindToken(firstToken)
    if (parsedKind) {
      kind = parsedKind
      remaining = remaining.slice(firstToken.length).trim()
    }
  }

  return {
    kind,
    title: remaining || DEFAULT_TITLE,
    usedPlaceholderTitle: remaining.length === 0,
  }
}

export function getIssueCommandHelp(): string {
  return [
    'Generate a deterministic, model-executable GitHub issue draft.',
    '',
    'Usage:',
    '  /issue [requirement|design|work-order|bug] <title>',
    '  /issue --type <requirement|design|work-order|bug> <title>',
    '  /issue work-order <title> --upstream REQ-FOO-001 --upstream DES-FOO-001',
    '  /issue bug <title> --entry src/app.ts --create',
    '',
    'Examples:',
    '  /issue requirement Define checkout fulfillment holds',
    '  /issue design Define remote session reconnect behavior',
    '  /issue work-order Add retry budget logging to the RPC client',
    '  /issue --type bug Settings panel drops unsaved edits',
    '',
    'Flags:',
    '  --upstream, -u   Repeatable upstream REQ/DES/AC/COV reference',
    '  --entry, -e      Repeatable entry point path or command',
    '  --trunk          trunk-safe | trunk-touch',
    '  --create         Create the GitHub issue with gh after writing the draft',
    '  --repo, -R       Override the detected repository (owner/repo)',
    '  --label, -l      Repeatable GitHub label to apply on create',
    '  --assignee, -a   Repeatable GitHub assignee to apply on create',
    '  --draft-path     Override the written draft path',
  ].join('\n')
}

export function deriveArtifactStem(title: string): string {
  const rawTokens = title
    .toUpperCase()
    .match(/[A-Z0-9]+/g)
    ?.filter(token => token.length > 1) ?? ['TASK']

  const filteredTokens = rawTokens.filter(token => !STOP_WORDS.has(token))
  const chosenTokens = (filteredTokens.length > 0 ? filteredTokens : rawTokens)
    .slice(0, 3)
    .map(token => token.slice(0, 12))

  return chosenTokens.join('-') || 'TASK'
}

export function buildIssueIdentifiers(
  kind: IssueTemplateKind,
  title: string,
): IssueIdentifierBundle {
  const details = ISSUE_TEMPLATE_DETAILS[kind]
  const artifactId = `${details.artifactPrefix}-${deriveArtifactStem(title)}-001`

  return {
    artifactId,
    acceptanceBaseId: `AC-${artifactId}`,
    coverageId: `COV-${artifactId}`,
  }
}

function renderBulletList(
  values: string[],
  placeholder: string,
): string[] {
  if (values.length === 0) {
    return [`- ${placeholder}`]
  }
  return values.map(value => `- ${value}`)
}

function buildHeader({
  kind,
  title,
  repository,
  generatedAt,
}: Pick<IssueScaffoldInput, 'kind' | 'title' | 'repository' | 'generatedAt'>): string[] {
  const details = ISSUE_TEMPLATE_DETAILS[kind]
  const identifiers = buildIssueIdentifiers(kind, title)

  return [
    `# ${title}`,
    '',
    `Artifact Type: ${details.label}`,
    `Artifact ID: ${identifiers.artifactId}`,
    `Coverage ID: ${identifiers.coverageId}`,
    ...(repository ? [`Repository: ${repository}`] : []),
    ...(generatedAt ? [`Generated: ${generatedAt}`] : []),
    `Stage Summary: ${details.stageSummary}`,
    `Transformation Rule: ${details.transformationRule}`,
    '',
  ]
}

function buildRequirementScaffold(input: IssueScaffoldInput): string {
  const { kind, title, upstreamIds = [], entryPoints = [], trunkExpectation } =
    input
  const identifiers = buildIssueIdentifiers(kind, title)

  return [
    ...buildHeader(input),
    '## Problem',
    '- What user or business problem requires this capability?',
    '- Why is now the right time to define it precisely?',
    '',
    '## User/Developer Impact',
    '- Who benefits when this requirement exists?',
    '- What failure, delay, or ambiguity disappears if it is satisfied?',
    '',
    '## Scope',
    '- Describe the exact capability this requirement covers.',
    '- Keep it atomic enough that downstream design can map to it cleanly.',
    '',
    '## Out of Scope',
    '- Call out nearby capabilities that deserve separate requirement IDs.',
    '',
    '## Upstream Context',
    ...renderBulletList(upstreamIds, 'No upstream references supplied.'),
    '- Product / business context:',
    '- Related customer reports or source artifacts:',
    '- Technical constraints already known:',
    '',
    '## Requirement Statement',
    `- ${identifiers.artifactId}: As a [role], I want to [capability], so that I can [outcome].`,
    '',
    '## Acceptance Criteria',
    `- [ ] ${identifiers.acceptanceBaseId}.1: When [condition], the system shall [behavior].`,
    `- [ ] ${identifiers.acceptanceBaseId}.2: When [condition], the system shall [behavior].`,
    `- [ ] ${identifiers.acceptanceBaseId}.3: When [condition], the system shall [behavior].`,
    '',
    '## Suggested Entry Points',
    ...renderBulletList(
      entryPoints,
      'Existing docs, code paths, or users who can validate intent:',
    ),
    '',
    '## Verification / Coverage',
    `### ${identifiers.coverageId}`,
    '- Test command:',
    '- Manual flow:',
    '- Assertions tied to the acceptance criteria above:',
    '- Gaps / follow-ups:',
    '',
    '## Trunk Expectations',
    `- Selected: ${trunkExpectation ?? 'trunk-safe'}`,
    '- Escalate to trunk-touch only if satisfying the requirement necessarily crosses guarded shared surfaces.',
  ].join('\n')
}

function buildDesignScaffold(input: IssueScaffoldInput): string {
  const { kind, title, upstreamIds = [], entryPoints = [], trunkExpectation } =
    input
  const identifiers = buildIssueIdentifiers(kind, title)

  return [
    ...buildHeader(input),
    '## Problem',
    '- What uncertainty, risk, or architectural gap needs a design decision?',
    '',
    '## User/Developer Impact',
    '- Who is blocked until this design is explicit?',
    '- What rework or drift does this design prevent?',
    '',
    '## Scope',
    '- List the systems, flows, and interfaces this design must cover.',
    '',
    '## Out of Scope',
    '- List implementation tasks, migrations, and future ideas that should stay out of this design doc.',
    '',
    '## Upstream Requirements',
    ...renderBulletList(upstreamIds, 'Required IDs: `REQ-...`, `AC-...`'),
    '- Copy the relevant upstream text verbatim before proposing solutions.',
    '- If no upstream requirement exists, stop and create one first.',
    '',
    '## Design Decisions',
    `- DEC-${identifiers.artifactId}.01: [decision]`,
    `- DEC-${identifiers.artifactId}.02: [decision]`,
    '- For each decision, record tradeoffs and impacted runtime boundaries.',
    '',
    '## Acceptance Criteria',
    `- [ ] ${identifiers.acceptanceBaseId}.1: The design maps each upstream requirement to a concrete system boundary or flow.`,
    `- [ ] ${identifiers.acceptanceBaseId}.2: Failure modes, invariants, and non-goals are explicit.`,
    `- [ ] ${identifiers.acceptanceBaseId}.3: The design is specific enough that a work order can inherit it without reinterpretation.`,
    '',
    '## Suggested Entry Points',
    ...renderBulletList(
      entryPoints,
      'Current code paths, docs, diagrams, incidents, or prior issues that should anchor the design:',
    ),
    '',
    '## Verification / Review Plan',
    `### ${identifiers.coverageId}`,
    '- Review checklist:',
    '- Diagrams / traces to inspect:',
    '- Concrete questions that must be resolved before implementation starts:',
    '',
    '## Trunk Expectations',
    `- Selected: ${trunkExpectation ?? 'trunk-safe'}`,
    '- Escalate to trunk-touch only if the resulting implementation will necessarily cross guarded shared surfaces.',
  ].join('\n')
}

function buildWorkOrderScaffold(input: IssueScaffoldInput): string {
  const { kind, title, upstreamIds = [], entryPoints = [], trunkExpectation } =
    input
  const identifiers = buildIssueIdentifiers(kind, title)

  return [
    ...buildHeader(input),
    '## Summary',
    '- What outcome ships when this work order is complete?',
    '- Why is this the smallest independently reviewable slice?',
    '',
    '## In Scope',
    '- List the exact files, commands, behaviors, and tests this work order may touch.',
    '',
    '## Out of Scope',
    '- List tempting cleanup, refactors, and adjacent capabilities that must stay separate.',
    '',
    '## Requirements',
    ...renderBulletList(
      upstreamIds,
      'Required upstream IDs: `REQ-...`, `AC-...`, `DES-...`',
    ),
    '- Copy the upstream requirement text verbatim here before implementation begins.',
    '- Do not renumber or paraphrase inherited IDs.',
    '',
    '## Blueprints / Design References',
    ...renderBulletList(entryPoints, 'Code / docs / tests to inspect first:'),
    '- Integration points and invariants to preserve:',
    '',
    '## Acceptance Criteria',
    `- [ ] ${identifiers.acceptanceBaseId}.1: The scoped behavior changes exactly as described by the inherited requirement/design IDs.`,
    `- [ ] ${identifiers.acceptanceBaseId}.2: The change adds or updates the minimum regression coverage needed to keep the slice safe.`,
    `- [ ] ${identifiers.acceptanceBaseId}.3: Reviewers can validate completion without inferring missing context.`,
    '',
    '## Suggested Entry Points',
    ...renderBulletList(
      entryPoints,
      'Primary files, commands, tests, or services a contributor should open first:',
    ),
    '',
    '## E2E Acceptance Tests',
    `### ${identifiers.coverageId}`,
    '- Test command:',
    '- Manual flow:',
    '- Assertions mapped to the acceptance criteria above:',
    '- Known gaps / deferred coverage:',
    '',
    '## Trunk Expectations',
    `- Selected: ${trunkExpectation ?? 'trunk-safe'}`,
    '- Escalate to trunk-touch only if trunk ownership or shared infrastructure makes isolation impossible.',
  ].join('\n')
}

function buildBugScaffold(input: IssueScaffoldInput): string {
  const { kind, title, upstreamIds = [], entryPoints = [], trunkExpectation } =
    input
  const identifiers = buildIssueIdentifiers(kind, title)

  return [
    ...buildHeader(input),
    '## Problem',
    '- What is failing now, and what should happen instead?',
    '',
    '## Reproduction',
    '- Environment:',
    '- Steps to reproduce:',
    '- Actual result:',
    '- Expected result:',
    '',
    '## User/Developer Impact',
    '- Who is affected, how often, and how severely?',
    '',
    '## Scope',
    '- Constrain the fix to the broken behavior, its guardrails, and the required tests.',
    '',
    '## Out of Scope',
    '- List unrelated cleanup, large refactors, and adjacent bugs that should not piggyback here.',
    '',
    '## Upstream References',
    ...renderBulletList(
      upstreamIds,
      'Related requirement IDs: `REQ-...`, related design IDs: `DES-...`',
    ),
    ...renderBulletList(
      entryPoints,
      'Suspect files, tests, logs, dashboards, or incidents:',
    ),
    '',
    '## Acceptance Criteria',
    `- [ ] ${identifiers.acceptanceBaseId}.1: The documented repro no longer fails under the same conditions.`,
    `- [ ] ${identifiers.acceptanceBaseId}.2: Expected behavior is explicit and tied back to a requirement or design reference.`,
    `- [ ] ${identifiers.acceptanceBaseId}.3: Regression coverage exists or the remaining gap is explicitly documented.`,
    '',
    '## Suggested Entry Points',
    ...renderBulletList(
      entryPoints,
      'Failing command, screen, file, log path, or test to inspect first:',
    ),
    '',
    '## Verification / Coverage',
    `### ${identifiers.coverageId}`,
    '- Failing-before-fix command or repro:',
    '- Passing-after-fix command or manual flow:',
    '- Assertions:',
    '- Missing coverage / residual risk:',
    '',
    '## Trunk Expectations',
    `- Selected: ${trunkExpectation ?? 'trunk-safe'}`,
    '- Escalate to trunk-touch only if the fix necessarily crosses guarded shared surfaces.',
  ].join('\n')
}

export function buildIssueScaffold(input: IssueScaffoldInput): string {
  if (input.kind === 'requirement-definition') {
    return buildRequirementScaffold(input)
  }
  if (input.kind === 'spec-design-doc') {
    return buildDesignScaffold(input)
  }
  if (input.kind === 'bug-regression') {
    return buildBugScaffold(input)
  }

  return buildWorkOrderScaffold(input)
}
