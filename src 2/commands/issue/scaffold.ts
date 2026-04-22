export type IssueTemplateKind =
  | 'leaf-build'
  | 'spec-design-doc'
  | 'bug-regression'

export type ParsedIssueCommandArgs = {
  kind: IssueTemplateKind
  title: string
  usedPlaceholderTitle: boolean
}

const DEFAULT_KIND: IssueTemplateKind = 'leaf-build'
const DEFAULT_TITLE = 'TODO: concise, outcome-focused issue title'

const ISSUE_TEMPLATE_DETAILS: Record<
  IssueTemplateKind,
  {
    label: string
    aliases: string[]
    summary: string
    impactPrompt: string
    scopePrompt: string
    outOfScopePrompt: string
    acceptancePrompt: string
    entryPointPrompt: string
    verificationPrompt: string
  }
> = {
  'leaf-build': {
    label: 'leaf build',
    aliases: ['leaf', 'leaf-build', 'build'],
    summary: 'Focused implementation slice that should be independently shippable.',
    impactPrompt:
      'Name the user or developer workflow that gets faster, safer, or less manual.',
    scopePrompt:
      'List the specific files, flows, or command surfaces that this slice is allowed to touch.',
    outOfScopePrompt:
      'Call out adjacent work that should stay untouched in this issue.',
    acceptancePrompt:
      'Write concrete completion checks that a reviewer can verify without guessing.',
    entryPointPrompt:
      'Point to the files, commands, tests, or services a contributor should open first.',
    verificationPrompt:
      'Include the exact command, manual flow, or assertion that proves the change works.',
  },
  'spec-design-doc': {
    label: 'spec / design doc',
    aliases: ['spec', 'design', 'spec-design-doc'],
    summary:
      'Define the intended approach before implementation crosses multiple moving parts.',
    impactPrompt:
      'Explain what uncertainty, churn, or coordination cost this spec is meant to reduce.',
    scopePrompt:
      'Describe the systems, user journeys, or interfaces the design must cover.',
    outOfScopePrompt:
      'List implementation work, migration steps, or future ideas that should not be decided here.',
    acceptancePrompt:
      'Describe the decisions, diagrams, or open-question resolution needed for sign-off.',
    entryPointPrompt:
      'Point to the current code paths, docs, or prior issues the design should build from.',
    verificationPrompt:
      'Describe how reviewers will validate that the doc is complete and actionable.',
  },
  'bug-regression': {
    label: 'bug / regression',
    aliases: ['bug', 'regression', 'bug-regression'],
    summary: 'Capture a concrete failure mode with enough detail to reproduce and fix it.',
    impactPrompt:
      'State who is affected, how often it happens, and what breaks when it does.',
    scopePrompt:
      'Constrain the fix to the broken behavior, its guardrails, and the needed tests.',
    outOfScopePrompt:
      'List unrelated cleanup, refactors, or follow-on bugs that should not piggyback here.',
    acceptancePrompt:
      'Describe the before/after behavior in a way a tester can validate directly.',
    entryPointPrompt:
      'List the failing command, screen, file, log path, or test that exposes the regression.',
    verificationPrompt:
      'Include a repro before the fix and the exact check that proves the regression is gone.',
  },
}

function normalizeKindToken(rawKind: string): IssueTemplateKind | null {
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
    const parsedKind = normalizeKindToken(typeFlagMatch[1])
    if (parsedKind) {
      kind = parsedKind
      remaining = remaining.slice(typeFlagMatch[0].length).trim()
    } else {
      return null
    }
  } else if (remaining.length > 0) {
    const [firstToken] = remaining.split(/\s+/, 1)
    const parsedKind = normalizeKindToken(firstToken)
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
    'Generate a model-executable GitHub issue draft.',
    '',
    'Usage:',
    '  /issue [leaf|spec|bug] <title>',
    '  /issue --type <leaf|spec|bug> <title>',
    '',
    'Examples:',
    '  /issue leaf Add retry budget logging to the RPC client',
    '  /issue --type bug Settings panel drops unsaved edits',
    '  /issue spec Define remote session reconnect behavior',
  ].join('\n')
}

export function buildIssueScaffold({
  kind,
  title,
}: {
  kind: IssueTemplateKind
  title: string
}): string {
  const details = ISSUE_TEMPLATE_DETAILS[kind]

  return [
    `# ${title}`,
    '',
    `Type: ${details.label}`,
    `Summary: ${details.summary}`,
    '',
    '## Problem',
    '- What is broken, missing, or ambiguous today?',
    '- Why is it worth fixing now instead of later?',
    '',
    '## User/Developer Impact',
    `- ${details.impactPrompt}`,
    '- Note the concrete friction, failure mode, or missed capability.',
    '',
    '## Scope',
    `- ${details.scopePrompt}`,
    '- Keep the slice small enough to finish without hidden follow-up work.',
    '',
    '## Out of Scope',
    `- ${details.outOfScopePrompt}`,
    '- Be explicit about tempting nearby work that should stay out.',
    '',
    '## Acceptance Criteria',
    `- [ ] ${details.acceptancePrompt}`,
    '- [ ] Include at least one observable behavior or artifact that changes.',
    '- [ ] Define what "done" means for review and handoff.',
    '',
    '## Suggested Entry Points',
    `- ${details.entryPointPrompt}`,
    '- Include enough file or command references to make the first step obvious.',
    '',
    '## Verification / Test Plan',
    `- [ ] ${details.verificationPrompt}`,
    '- [ ] List the exact automated test command or manual repro flow.',
    '- [ ] Call out any missing coverage or validation gaps.',
    '',
    '## Trunk Expectations',
    '- Preferred: trunk-safe',
    '- Escalate to trunk-touch only if the issue must cross guarded files or shared infra.',
  ].join('\n')
}
