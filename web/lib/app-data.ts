// Mock data for the new app modules: Refinery / Foundry / Planner / Validator / Proofs.
// Pure data — no React, no fetch. Swap to a real API in lib/api.ts later.

export type Severity = 'info' | 'warn' | 'error'

export type ProofStatus = 'unproven' | 'partial' | 'discharged' | 'stale'
export type WorkOrderStatus = 'todo' | 'in_progress' | 'in_review' | 'blocked' | 'done'
export type IndexingStatus = 'idle' | 'indexing' | 'ready' | 'failed' | 'stale'
export type ObligationKind = 'safety' | 'security' | 'compliance' | 'functional'

export type Project = {
  slug: string
  name: string
  description: string
  archetype: string
  tenantId: string
  github: { repo: string; branch: string; lastIndexedSha: string }
  createdAt: string
}

export type IndexingState = {
  repo: string
  branch: string
  files: number
  symbols: number
  status: IndexingStatus
  lastIndexedAt: string
  durationMs: number
}

export type WorkOrder = {
  id: string
  slug: string
  title: string
  status: WorkOrderStatus
  proofStatus: ProofStatus
  phase: 'discovery' | 'design' | 'implementation' | 'verification' | 'release'
  assignee: { name: string; initials: string } | null
  createdAt: string
  blueprintId: string | null
  requirementIds: string[]
  obligationIds: string[]
  files: WorkOrderFile[]
  activity: WorkOrderActivityEvent[]
}

export type WorkOrderFile = {
  path: string
  change: 'create' | 'modify'
  status: 'pending' | 'drafted' | 'committed'
}

export type WorkOrderActivityEvent =
  | { kind: 'comment'; t: string; author: string; text: string; flagged?: boolean }
  | { kind: 'system'; t: string; text: string }
  | { kind: 'log'; t: string; text: string }

export type Blueprint = {
  id: string
  group: 'foundation' | 'system' | 'feature'
  title: string
  prose: string
  formalSummary: string
  diagramKind: 'erd' | 'sequence' | 'architecture' | null
  obligationIds: string[]
}

export type Requirement = {
  id: string
  group: 'product_overview' | 'feature_requirement'
  title: string
  body: string
  obligationIds: string[]
}

export type EvidenceItem = {
  id: string
  kind: 'test' | 'spec' | 'run' | 'review'
  label: string
  ref: string
  addedAt: string
  size?: string
}

export type Obligation = {
  id: string
  kind: ObligationKind
  title: string
  description: string
  status: ProofStatus
  evidenceCount: number
  tags: string[]
  workOrderIds: string[]
  /** Long-form rationale for why this obligation exists. */
  rationale?: string
  /** Counterexample summary if status is failed/partial/unproven; null when discharged. */
  counterexample?: string | null
  /** Concrete artifacts attached as proof. */
  evidence?: EvidenceItem[]
}

export type FlaggedComment = {
  id: string
  workOrderId: string
  author: string
  text: string
  t: string
}

export type KpiSummary = {
  module: 'overview' | 'refinery' | 'foundry' | 'planner' | 'validator' | 'proofs'
  label: string
  value: string
  trend?: { direction: 'up' | 'down' | 'flat'; delta: string }
  hint: string
  href: string
}

export const PROJECT: Project = {
  slug: 'vendor-onboarding',
  name: 'Vendor onboarding',
  description: 'W9, COI, MSA capture with approver workflow',
  archetype: 'CRUD + auth + approval',
  tenantId: 'local',
  github: {
    repo: 'acme-inc/vendor-onboarding',
    branch: 'main',
    lastIndexedSha: 'e8a217f',
  },
  createdAt: '2026-04-22T10:30:00Z',
}

export const PROJECTS: Project[] = [PROJECT]

export const INDEXING: IndexingState = {
  repo: PROJECT.github.repo,
  branch: PROJECT.github.branch,
  files: 142,
  symbols: 1847,
  status: 'ready',
  lastIndexedAt: '2026-04-25T18:42:00Z',
  durationMs: 4720,
}

export const REQUIREMENTS: Requirement[] = [
  {
    id: 'PR-001',
    group: 'product_overview',
    title: 'Approver-gated vendor lifecycle',
    body:
      'Vendors move from draft → pending → approved | rejected. Active status requires an unexpired COI and a non-empty MSA URL. Only users with role=approver can transition out of pending.',
    obligationIds: ['OB-002', 'OB-005'],
  },
  {
    id: 'FR-001',
    group: 'feature_requirement',
    title: 'Vendor record creation',
    body:
      'Authorized users create a vendor record with required fields: legal name, EIN, COI expiry, MSA URL.',
    obligationIds: ['OB-001'],
  },
  {
    id: 'FR-002',
    group: 'feature_requirement',
    title: 'List & detail views',
    body:
      'List paginates 25 per page, sortable by name and status. Detail shows all fields plus the audit history.',
    obligationIds: [],
  },
  {
    id: 'FR-003',
    group: 'feature_requirement',
    title: 'Approval requires session manager',
    body:
      'manager_id is sourced from session.user.id on approve. The request body cannot override the session.',
    obligationIds: ['OB-002', 'OB-003'],
  },
  {
    id: 'FR-004',
    group: 'feature_requirement',
    title: 'Status transitions emit audit',
    body:
      'Every status change emits an audit event with prior + new status, actor, and timestamp.',
    obligationIds: ['OB-004'],
  },
  {
    id: 'FR-005',
    group: 'feature_requirement',
    title: 'Compliance gates',
    body: 'COI expiry blocks active. Missing MSA blocks approved.',
    obligationIds: ['OB-005'],
  },
]

export const OBLIGATIONS: Obligation[] = [
  {
    id: 'OB-001',
    kind: 'functional',
    title: 'Required fields rejected when missing',
    description:
      'Vendor creation must reject any record missing legal name, EIN, COI expiry, or MSA URL.',
    rationale:
      'Downstream compliance gates assume these fields are present. Allowing nullable creation makes the entire approval workflow unsound.',
    counterexample: null,
    status: 'discharged',
    evidenceCount: 2,
    tags: ['validation'],
    workOrderIds: ['WO-001'],
    evidence: [
      { id: 'EV-001a', kind: 'test', label: 'creates rejected when EIN missing', ref: 'tests/vendors.create.test.ts', addedAt: '2026-04-23T11:18:00Z' },
      { id: 'EV-001b', kind: 'spec', label: 'FR-001 clause snapshot', ref: 'specs/FR-001@a8f3c2.md', addedAt: '2026-04-23T11:02:00Z' },
    ],
  },
  {
    id: 'OB-002',
    kind: 'security',
    title: 'manager_id only from session',
    description:
      'On approve, manager_id MUST come from the authenticated session and the body field MUST be ignored.',
    rationale:
      'The §4 reviewer flag found this concretely — a body-field override would let any caller approve as an arbitrary manager. This obligation is the structural fix.',
    counterexample: null,
    status: 'discharged',
    evidenceCount: 3,
    tags: ['authz', 'session'],
    workOrderIds: ['WO-002'],
    evidence: [
      { id: 'EV-002a', kind: 'test', label: 'approve uses session manager_id', ref: 'tests/approvals.session.test.ts', addedAt: '2026-04-24T09:16:00Z' },
      { id: 'EV-002b', kind: 'test', label: 'body manager_id is ignored', ref: 'tests/approvals.body-override.test.ts', addedAt: '2026-04-24T09:16:00Z' },
      { id: 'EV-002c', kind: 'review', label: 'reviewer agreed §4 (post-retry)', ref: 'reviewer/verdict.json#§4', addedAt: '2026-04-24T09:16:00Z' },
    ],
  },
  {
    id: 'OB-003',
    kind: 'security',
    title: 'Approver role enforced at handler',
    description: 'A non-approver request to /vendors/:id/approve must be rejected with 403.',
    rationale:
      'The role check is on the route, not the data layer. If an upstream proxy strips the role header, the handler is the last line.',
    counterexample: null,
    status: 'discharged',
    evidenceCount: 1,
    tags: ['authz'],
    workOrderIds: ['WO-002'],
    evidence: [
      { id: 'EV-003a', kind: 'test', label: 'non-approver gets 403', ref: 'tests/approvals.role.test.ts', addedAt: '2026-04-24T09:16:00Z' },
    ],
  },
  {
    id: 'OB-004',
    kind: 'compliance',
    title: 'Audit trail on every status transition',
    description:
      'Each status transition emits an audit event capturing prior status, new status, actor, and timestamp.',
    rationale:
      'Compliance requires reconstructing the full lifecycle of each vendor record. Missing transitions on any path break the chain.',
    counterexample:
      'reject() handler in routes/approvals.ts does not call recorder.emit(). The pending → rejected transition is invisible to the audit pack.',
    status: 'partial',
    evidenceCount: 1,
    tags: ['audit', 'compliance'],
    workOrderIds: ['WO-003'],
    evidence: [
      { id: 'EV-004a', kind: 'test', label: 'approve emits audit event', ref: 'tests/audit.approve.test.ts', addedAt: '2026-04-25T09:21:00Z' },
    ],
  },
  {
    id: 'OB-005',
    kind: 'compliance',
    title: 'Active requires unexpired COI',
    description: 'A vendor cannot reach status=active if COI expiry is in the past.',
    rationale:
      'Active vendors can transact. An expired COI breaks downstream insurance assumptions and is a hard compliance fail.',
    counterexample:
      'lib/compliance.ts is not yet written. routes/vendors.ts allows status=active without checking coi_expiry against now().',
    status: 'unproven',
    evidenceCount: 0,
    tags: ['compliance'],
    workOrderIds: ['WO-004'],
    evidence: [],
  },
  {
    id: 'OB-006',
    kind: 'safety',
    title: 'No stale approver session',
    description:
      'Approve must reject if the session is older than the configured window (default 12h).',
    rationale:
      'A long-lived session token from a compromised laptop should not be able to approve days later. Freshness limit caps blast radius.',
    counterexample:
      'Last evidence run was 8 days ago against an older session model. Re-verify required against the current session shape.',
    status: 'stale',
    evidenceCount: 1,
    tags: ['session'],
    workOrderIds: [],
    evidence: [
      { id: 'EV-006a', kind: 'test', label: '12h freshness window enforced', ref: 'tests/session.fresh.test.ts', addedAt: '2026-04-17T14:02:00Z' },
    ],
  },
  {
    id: 'OB-007',
    kind: 'security',
    title: 'No PII in audit chain',
    description:
      'Audit events must not contain PII fields. PII goes to a separate erasable store keyed by event id.',
    rationale:
      'GDPR erasure requests must succeed without breaking chain integrity. PII directly in the chain makes erasure impossible.',
    counterexample:
      'audit/recorder.ts current draft includes `email` and `legal_name` directly in event payload. Tombstone pattern not yet applied.',
    status: 'partial',
    evidenceCount: 2,
    tags: ['audit', 'pii'],
    workOrderIds: ['WO-003'],
    evidence: [
      { id: 'EV-007a', kind: 'spec', label: 'PII tombstone policy v0.1', ref: 'specs/policies/pii-tombstone.md', addedAt: '2026-04-25T08:40:00Z' },
      { id: 'EV-007b', kind: 'review', label: 'reviewer flagged email in payload', ref: 'reviewer/verdict.json#OB-007', addedAt: '2026-04-25T09:48:00Z' },
    ],
  },
]

export const BLUEPRINTS: Blueprint[] = [
  {
    id: 'BP-FND-001',
    group: 'foundation',
    title: 'Tenant isolation & audit chain',
    prose:
      'Every record carries tenant_id. Audit events are append-only, hash-linked, and PII-tombstoned. Cross-tenant access raises an alarm within 30s.',
    formalSummary:
      'forall record r: r.tenant_id ∈ session.tenant_set; ∀ audit event e_n: e_n.prev = sha256(canonical(e_{n-1}))',
    diagramKind: 'architecture',
    obligationIds: ['OB-007'],
  },
  {
    id: 'BP-SYS-001',
    group: 'system',
    title: 'Approval workflow sequence',
    prose:
      'Submit → Pending → (Approve | Reject) by approver role. Approval reads manager_id from session, never body. Each transition writes audit.',
    formalSummary:
      'state_machine(draft, pending, approved, rejected) with guards [role=approver ∧ session.fresh] on out-of-pending transitions',
    diagramKind: 'sequence',
    obligationIds: ['OB-002', 'OB-003', 'OB-006'],
  },
  {
    id: 'BP-FEA-001',
    group: 'feature',
    title: 'Vendor record schema',
    prose:
      'A vendor has legal name, EIN, COI expiry, MSA URL. Lifecycle status: draft|pending|approved|rejected|active. Active gated by COI + MSA.',
    formalSummary:
      'Vendor = { name: string, ein: string, coi_expiry: date, msa_url: url, status: enum }; ∀ v: v.status = active ⇒ v.coi_expiry > now ∧ v.msa_url ≠ ""',
    diagramKind: 'erd',
    obligationIds: ['OB-001', 'OB-005'],
  },
  {
    id: 'BP-FEA-002',
    group: 'feature',
    title: 'Approver action surface',
    prose:
      'Approver role has approve/reject mutations on pending records. Other roles can list and view detail only. All mutations audited.',
    formalSummary:
      'permission_matrix: { approver: [approve, reject, view, list], engineer: [view, list], viewer: [view] }',
    diagramKind: null,
    obligationIds: ['OB-002', 'OB-003', 'OB-004'],
  },
]

export const WORK_ORDERS: WorkOrder[] = [
  {
    id: 'WO-001',
    slug: 'vendor-create-handler',
    title: 'Vendor create handler with required-field validation',
    status: 'done',
    proofStatus: 'discharged',
    phase: 'release',
    assignee: { name: 'Builder agent', initials: 'BA' },
    createdAt: '2026-04-23T11:02:00Z',
    blueprintId: 'BP-FEA-001',
    requirementIds: ['FR-001'],
    obligationIds: ['OB-001'],
    files: [
      { path: 'routes/vendors.ts', change: 'create', status: 'committed' },
      { path: 'schemas/vendor.ts', change: 'create', status: 'committed' },
    ],
    activity: [
      { kind: 'system', t: '2026-04-23T11:02:00Z', text: 'WO opened from spec FR-001' },
      { kind: 'log', t: '2026-04-23T11:14:00Z', text: 'Builder wrote routes/vendors.ts (53 lines)' },
      { kind: 'log', t: '2026-04-23T11:18:00Z', text: 'Reviewer verdict: §1 satisfied' },
      { kind: 'comment', t: '2026-04-23T13:30:00Z', author: 'priya', text: 'Looks good. Merging.' },
    ],
  },
  {
    id: 'WO-002',
    slug: 'approval-session-source',
    title: 'manager_id sourced from session, not body',
    status: 'done',
    proofStatus: 'discharged',
    phase: 'release',
    assignee: { name: 'Builder agent', initials: 'BA' },
    createdAt: '2026-04-24T09:11:00Z',
    blueprintId: 'BP-SYS-001',
    requirementIds: ['FR-003'],
    obligationIds: ['OB-002', 'OB-003'],
    files: [
      { path: 'routes/approvals.ts', change: 'modify', status: 'committed' },
    ],
    activity: [
      { kind: 'system', t: '2026-04-24T09:11:00Z', text: 'Reviewer flagged §4 — body override' },
      { kind: 'log', t: '2026-04-24T09:14:00Z', text: 'Builder retried with constraint' },
      { kind: 'log', t: '2026-04-24T09:16:00Z', text: 'Reviewer verdict: §4 satisfied' },
      {
        kind: 'comment',
        t: '2026-04-24T10:02:00Z',
        author: 'devon',
        text: 'Should we also rotate the session window after a failed approve attempt?',
        flagged: true,
      },
    ],
  },
  {
    id: 'WO-003',
    slug: 'audit-on-status-transitions',
    title: 'Audit event on every status transition',
    status: 'in_review',
    proofStatus: 'partial',
    phase: 'verification',
    assignee: { name: 'Devon Park', initials: 'DP' },
    createdAt: '2026-04-25T08:40:00Z',
    blueprintId: 'BP-SYS-001',
    requirementIds: ['FR-004'],
    obligationIds: ['OB-004', 'OB-007'],
    files: [
      { path: 'routes/approvals.ts', change: 'modify', status: 'drafted' },
      { path: 'audit/recorder.ts', change: 'create', status: 'drafted' },
    ],
    activity: [
      { kind: 'system', t: '2026-04-25T08:40:00Z', text: 'WO opened from blueprint BP-SYS-001' },
      { kind: 'log', t: '2026-04-25T09:21:00Z', text: 'Builder drafted audit/recorder.ts' },
      {
        kind: 'comment',
        t: '2026-04-25T09:48:00Z',
        author: 'priya',
        text: 'Make sure recorder uses the redaction policy — PR-001 calls this out.',
      },
    ],
  },
  {
    id: 'WO-004',
    slug: 'coi-expiry-gate',
    title: 'COI expiry gate on active status',
    status: 'in_progress',
    proofStatus: 'unproven',
    phase: 'implementation',
    assignee: null,
    createdAt: '2026-04-25T15:11:00Z',
    blueprintId: 'BP-FEA-001',
    requirementIds: ['FR-005'],
    obligationIds: ['OB-005'],
    files: [
      { path: 'routes/vendors.ts', change: 'modify', status: 'pending' },
      { path: 'lib/compliance.ts', change: 'create', status: 'pending' },
    ],
    activity: [
      { kind: 'system', t: '2026-04-25T15:11:00Z', text: 'WO opened from FR-005' },
    ],
  },
  {
    id: 'WO-005',
    slug: 'session-freshness-window',
    title: 'Session freshness window for approve',
    status: 'todo',
    proofStatus: 'stale',
    phase: 'design',
    assignee: null,
    createdAt: '2026-04-25T16:30:00Z',
    blueprintId: 'BP-SYS-001',
    requirementIds: [],
    obligationIds: ['OB-006'],
    files: [],
    activity: [
      { kind: 'system', t: '2026-04-25T16:30:00Z', text: 'WO drafted from comment on WO-002' },
    ],
  },
  {
    id: 'WO-006',
    slug: 'pii-tombstone-policy',
    title: 'PII tombstone policy in audit recorder',
    status: 'blocked',
    proofStatus: 'unproven',
    phase: 'design',
    assignee: { name: 'Builder agent', initials: 'BA' },
    createdAt: '2026-04-25T17:05:00Z',
    blueprintId: 'BP-FND-001',
    requirementIds: [],
    obligationIds: ['OB-007'],
    files: [],
    activity: [
      { kind: 'system', t: '2026-04-25T17:05:00Z', text: 'Blocked on counsel review of redaction list' },
    ],
  },
]

export const FLAGGED_COMMENTS: FlaggedComment[] = WORK_ORDERS.flatMap((wo) =>
  wo.activity
    .filter((event): event is Extract<WorkOrderActivityEvent, { kind: 'comment' }> =>
      event.kind === 'comment' && event.flagged === true,
    )
    .map((event) => ({
      id: `${wo.id}-${event.t}`,
      workOrderId: wo.id,
      author: event.author,
      text: event.text,
      t: event.t,
    })),
)

export const KPIS: KpiSummary[] = [
  {
    module: 'overview',
    label: 'Build success · 7d',
    value: '—',
    hint: 'publishes at GA',
    href: '/app/projects/vendor-onboarding/proofs',
  },
  {
    module: 'refinery',
    label: 'Open requirements',
    value: '6',
    trend: { direction: 'flat', delta: '0 / wk' },
    hint: '4 features · 1 product overview · 1 deferred',
    href: '/app/projects/vendor-onboarding/refinery',
  },
  {
    module: 'foundry',
    label: 'Blueprints',
    value: '4',
    trend: { direction: 'up', delta: '+1 / wk' },
    hint: '1 foundation · 1 system · 2 feature',
    href: '/app/projects/vendor-onboarding/foundry',
  },
  {
    module: 'planner',
    label: 'Pending work orders',
    value: '4',
    trend: { direction: 'up', delta: '+2 / wk' },
    hint: '2 done · 1 in review · 1 in progress · 1 todo · 1 blocked',
    href: '/app/projects/vendor-onboarding/planner',
  },
  {
    module: 'validator',
    label: 'Validator inbox',
    value: '0',
    hint: 'no pending submissions',
    href: '/app/projects/vendor-onboarding/validator',
  },
  {
    module: 'proofs',
    label: 'Proof obligations',
    value: '7',
    hint: '3 discharged · 2 partial · 1 unproven · 1 stale',
    href: '/app/projects/vendor-onboarding/proofs',
  },
]

export type CoverageCell = {
  requirementId: string
  obligationId: string
  status: ProofStatus | 'na'
}

export const COVERAGE: CoverageCell[] = REQUIREMENTS.flatMap((req) =>
  OBLIGATIONS.map((ob) => {
    if (!req.obligationIds.includes(ob.id)) {
      return { requirementId: req.id, obligationId: ob.id, status: 'na' as const }
    }
    return { requirementId: req.id, obligationId: ob.id, status: ob.status }
  }),
)

export const TOP_TABS = [
  { slug: 'overview', label: 'Overview' },
  { slug: 'refinery', label: 'Refinery' },
  { slug: 'foundry', label: 'Foundry' },
  { slug: 'planner', label: 'Planner' },
  { slug: 'validator', label: 'Validator' },
  { slug: 'proofs', label: 'Proofs' },
] as const

export const LEFT_NAV = [
  { slug: 'overview', label: 'Overview' },
  { slug: 'artifacts', label: 'Artifacts' },
  { slug: 'codebase', label: 'Codebase' },
  { slug: 'api-keys', label: 'API Keys' },
  { slug: 'settings', label: 'Settings' },
] as const

export type AgentMessage =
  | { id: string; role: 'agent'; t: string; text: string; tone?: 'neutral' | 'evidence' | 'warning' }
  | { id: string; role: 'user'; t: string; text: string }
  | { id: string; role: 'system'; t: string; text: string }

export const AGENT_DEFAULT_THREAD: AgentMessage[] = [
  {
    id: 'm1',
    role: 'system',
    t: '2026-04-25T18:30:00Z',
    text: 'Pinned context: WO-003, OB-004, BP-SYS-001.',
  },
  {
    id: 'm2',
    role: 'agent',
    t: '2026-04-25T18:30:05Z',
    tone: 'neutral',
    text: 'Reviewing WO-003 against OB-004. Found one missing call site for the recorder in routes/approvals.ts:reject().',
  },
  {
    id: 'm3',
    role: 'agent',
    t: '2026-04-25T18:30:08Z',
    tone: 'evidence',
    text: 'Evidence: tests/approvals.test.ts covers approve() but not reject(). Suggest adding a parallel case.',
  },
]

export const AGENT_DEFAULT_CHIPS = [
  'Re-verify proof',
  'Open counterexample',
  'Generate test',
  'Explain obligation',
  'Propose fix',
] as const

export function findWorkOrder(idOrSlug: string): WorkOrder | undefined {
  return WORK_ORDERS.find((wo) => wo.id === idOrSlug || wo.slug === idOrSlug)
}

export function findObligation(id: string): Obligation | undefined {
  return OBLIGATIONS.find((ob) => ob.id === id)
}

export function findRequirement(id: string): Requirement | undefined {
  return REQUIREMENTS.find((r) => r.id === id)
}

export function findBlueprint(id: string): Blueprint | undefined {
  return BLUEPRINTS.find((b) => b.id === id)
}

export const AGENT_MENTION_SUGGESTIONS = [
  ...REQUIREMENTS.map((r) => ({ id: r.id, label: r.title, kind: 'requirement' as const })),
  ...OBLIGATIONS.map((o) => ({ id: o.id, label: o.title, kind: 'obligation' as const })),
  ...WORK_ORDERS.map((w) => ({ id: w.id, label: w.title, kind: 'work-order' as const })),
  ...BLUEPRINTS.map((b) => ({ id: b.id, label: b.title, kind: 'blueprint' as const })),
]
