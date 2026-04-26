export type SpecClause = {
  id: string
  title: string
  body: string
}

export type Clarification = {
  q: string
  a: string
  confirmedAt: string
}

export type EvalCase = {
  id: string
  clause: string
  name: string
  status: 'pass' | 'fail' | 'pending'
}

export type AuditEvent = {
  id: string
  t: string
  kind: string
  actor: string
  cost: number
  ref?: string
  promptHash?: string
  modelId?: string
  parentId?: string
  childIds?: string[]
  body?: string
  prompt?: string
  response?: string
  auditHash?: string
  prevHash?: string | null
}

export type BuilderLine = {
  t: string
  text: string
  kind?: 'plan' | 'wrote' | 'attach'
}

export type ReviewerLine = {
  t: string
  text: string
  kind?: 'verdict' | 'flag' | 'gate' | 'agree'
}

export type ReconcileItem = {
  id: string
  direction: 'spec_to_code' | 'code_to_spec'
  detected: string
  summary: string
  diffPath: string
  status: 'pending' | 'approved' | 'rejected'
}

export type Project = {
  slug: string
  name: string
  description: string
  archetype: string
  tenantId: string
  github: { repo: string; branch: string }
  createdAt: string
  lastBuildId: string
}

export type Build = {
  id: string
  projectSlug: string
  status: 'sealed' | 'running' | 'failed' | 'paused'
  startedAt: string
  endedAt: string
  duration: string
  llmCost: number
  evalsTotal: number
  evalsPassed: number
  reviewerVerdict: 'agreed' | 'disagreed' | 'pending'
  artifacts: {
    appCode: { path: string; files: number; lines: number }
    audit: { path: string; count: number }
    auditPack: { path: string; size: string }
    reviewer: { path: string }
  }
}

export const PROJECT: Project = {
  slug: 'vendor-onboarding',
  name: 'Vendor onboarding form',
  description: 'W9, COI, MSA capture with approver workflow',
  archetype: 'CRUD + auth + approval',
  tenantId: 'local',
  github: { repo: 'acme-inc/vendor-onboarding', branch: 'main' },
  createdAt: '2026-04-22T10:30:00Z',
  lastBuildId: 'build-9c4a2',
}

export const BUILD: Build = {
  id: 'build-9c4a2',
  projectSlug: 'vendor-onboarding',
  status: 'sealed',
  startedAt: '2026-04-25T14:32:00Z',
  endedAt: '2026-04-25T14:36:12Z',
  duration: '4m 12s',
  llmCost: 0.42,
  evalsTotal: 12,
  evalsPassed: 12,
  reviewerVerdict: 'agreed',
  artifacts: {
    appCode: { path: 'app/**/*.ts', files: 8, lines: 412 },
    audit: { path: 'audit/events.jsonl', count: 24 },
    auditPack: { path: 'audit-pack.tar.gz', size: '4.2 KB' },
    reviewer: { path: 'reviewer/verdict.json' },
  },
}

export const SPEC_CLAUSES: SpecClause[] = [
  {
    id: '§1',
    title: 'Vendor record creation',
    body: 'Authorized users can create a vendor record. Required fields: legal name, EIN, COI expiry date, MSA URL.',
  },
  {
    id: '§2',
    title: 'Vendor list and detail views',
    body: 'List view paginates 25 per page, sortable by name and status. Detail view shows all fields and the full audit history for the record.',
  },
  {
    id: '§3',
    title: 'Approver role',
    body: 'A user with role=approver can approve or reject a vendor record. Other roles can only view.',
  },
  {
    id: '§4',
    title: 'Approval requires session manager_id',
    body: 'On approve, the manager_id is taken from the authenticated session. The request body cannot override the session manager_id.',
  },
  {
    id: '§5',
    title: 'Status transitions emit audit events',
    body: 'Every status transition (draft → pending → approved | rejected) emits an audit event capturing prior status, new status, actor, and timestamp.',
  },
  {
    id: '§6',
    title: 'Compliance gates',
    body: 'A vendor cannot reach status=active if the COI is expired. A vendor cannot reach status=approved if the MSA URL is empty.',
  },
]

export const CLARIFICATIONS: Clarification[] = [
  {
    q: 'Approvers — single-tier or multi-tier?',
    a: 'Single-tier: any user with role=approver.',
    confirmedAt: '2026-04-22T10:48:00Z',
  },
  {
    q: 'COI expiry handling — block at upload, on activation, or both?',
    a: 'Block on activation only.',
    confirmedAt: '2026-04-22T10:51:00Z',
  },
  {
    q: 'MSA storage — link to external system or upload locally?',
    a: 'External link (URL field).',
    confirmedAt: '2026-04-22T10:53:00Z',
  },
  {
    q: 'Audit events — internal-only or visible to vendor?',
    a: 'Internal-only at v1.',
    confirmedAt: '2026-04-22T10:55:00Z',
  },
]

export const EVALS: EvalCase[] = [
  { id: 'E1', clause: '§1', name: 'create vendor with required fields', status: 'pass' },
  { id: 'E2', clause: '§1', name: 'reject vendor missing EIN', status: 'pass' },
  { id: 'E3', clause: '§2', name: 'list vendors paginated', status: 'pass' },
  { id: 'E4', clause: '§2', name: 'view vendor detail', status: 'pass' },
  { id: 'E5', clause: '§3', name: 'approver can approve', status: 'pass' },
  { id: 'E6', clause: '§3', name: 'non-approver cannot approve', status: 'pass' },
  { id: 'E7', clause: '§4', name: 'approval requires session manager_id', status: 'pass' },
  { id: 'E8', clause: '§4', name: 'body cannot override manager_id', status: 'pass' },
  { id: 'E9', clause: '§5', name: 'status transition emits audit event', status: 'pass' },
  { id: 'E10', clause: '§5', name: 'audit event includes prior + new status', status: 'pass' },
  { id: 'E11', clause: '§6', name: 'COI expiry blocks active status', status: 'pass' },
  { id: 'E12', clause: '§6', name: 'MSA missing blocks approval', status: 'pass' },
]

export const BUILDER_STREAM: BuilderLine[] = [
  { t: '14:32:01', text: 'plan: scaffold Bun + lit-html + lowdb', kind: 'plan' },
  { t: '14:32:18', text: 'plan: 4 fields per spec — legal name, EIN, COI expiry, MSA url', kind: 'plan' },
  { t: '14:32:42', text: 'plan: approver role gates approve/reject mutations', kind: 'plan' },
  { t: '14:33:05', text: 'wrote routes/vendors.ts (53 lines)', kind: 'wrote' },
  { t: '14:33:28', text: 'wrote routes/approvals.ts (41 lines)', kind: 'wrote' },
  { t: '14:33:51', text: 'wrote schemas/vendor.ts (28 lines)', kind: 'wrote' },
  { t: '14:34:16', text: 'wrote ui/vendor-form.lit.ts (94 lines)', kind: 'wrote' },
  { t: '14:34:42', text: 'wrote ui/approval-queue.lit.ts (67 lines)', kind: 'wrote' },
  { t: '14:35:05', text: 'wrote db/migrations/001_init.sql (29 lines)', kind: 'wrote' },
  { t: '14:35:30', text: 'kairos:clause=§4 attached to approveVendor()', kind: 'attach' },
]

export const REVIEWER_STREAM: ReviewerLine[] = [
  { t: '14:32:48', text: '§1 pass — schema field set matches clause', kind: 'verdict' },
  { t: '14:33:12', text: '§2 pass — list and detail views present', kind: 'verdict' },
  { t: '14:33:34', text: '§3 pass — role check on approve mutation', kind: 'verdict' },
  { t: '14:34:01', text: '§4 flag — approveVendor reads manager_id from request body; body can override session', kind: 'flag' },
  { t: '14:34:22', text: 'gate: pause builder for §4 retry', kind: 'gate' },
  { t: '14:35:11', text: '§4 pass — manager_id now from session, not body', kind: 'verdict' },
  { t: '14:35:48', text: '§5 pass — audit trail on status transitions', kind: 'verdict' },
  { t: '14:35:58', text: '§6 pass — compliance gates wired', kind: 'verdict' },
  { t: '14:36:08', text: 'agree on all clauses', kind: 'agree' },
]

const RAW_AUDIT_EVENTS: Omit<AuditEvent, 'id' | 'auditHash' | 'prevHash'>[] = [
  { t: '14:32:00', kind: 'build_started', actor: 'orchestrator', cost: 0, modelId: '—' },
  { t: '14:32:00', kind: 'spec_loaded', actor: 'orchestrator', cost: 0, ref: 'spec.md@a8f3c2', modelId: '—' },
  {
    t: '14:32:01',
    kind: 'evals_generated',
    actor: 'eval-runner',
    cost: 0.02,
    ref: '12 cases',
    modelId: 'claude-opus-4-7',
    promptHash: '0x4a2e',
    prompt: 'Generate eval cases for each clause in spec.md. One required-success case and one required-failure case per clause where applicable. Output as evals/<spec-id>/<clause>.json.',
    response: 'Generated 12 eval cases across §1–§6. Required-success and required-failure cases attached to §1, §3, §4, §6. List-and-detail coverage on §2. Audit-emission coverage on §5.',
  },
  {
    t: '14:32:01',
    kind: 'builder_started',
    actor: 'builder',
    cost: 0,
    modelId: 'claude-opus-4-7',
    prompt: 'Implement the spec at spec.md against archetype CRUD + auth + approval. Write to app/**/*.ts. Attach kairos:clause=<id> anchors to functions that satisfy specific clauses.',
    response: 'Acknowledged. Plan: scaffold Bun + lit-html + lowdb, then route handlers per clause, then UI views, then migrations.',
  },
  {
    t: '14:32:01',
    kind: 'reviewer_started',
    actor: 'reviewer',
    cost: 0,
    modelId: 'claude-opus-4-7',
    prompt: 'You are the adversarial reviewer. Read each spec clause and check the builder’s output against it. Emit a verdict per clause (pass / flag) and the specific constraint that fails if any. Do not rubber-stamp.',
    response: 'Acknowledged. Will gate the workflow on any flagged clause until builder retries successfully.',
  },
  {
    t: '14:33:05',
    kind: 'builder_wrote_file',
    actor: 'builder',
    cost: 0.06,
    ref: 'routes/vendors.ts',
    modelId: 'claude-opus-4-7',
    promptHash: '0x9c1a',
    prompt: 'Implement §1 (vendor record creation) and §2 (list + detail). Required fields: legal name, EIN, COI expiry, MSA URL.',
    response: 'Wrote routes/vendors.ts (53 lines): POST /vendors with zod validation on the four required fields, GET /vendors paginated 25, GET /vendors/:id detail. kairos:clause=§1 and kairos:clause=§2 anchors attached.',
  },
  {
    t: '14:33:51',
    kind: 'builder_wrote_file',
    actor: 'builder',
    cost: 0.04,
    ref: 'schemas/vendor.ts',
    modelId: 'claude-opus-4-7',
    promptHash: '0xd7e2',
    prompt: 'Define the Vendor schema. Statuses: draft, pending, approved, rejected, active. Compliance fields: COI expiry (date), MSA URL (string).',
    response: 'Wrote schemas/vendor.ts (28 lines): zod object with the field set above and a status union. Status transitions are not enforced here — those live on the route handlers.',
  },
  {
    t: '14:34:01',
    kind: 'reviewer_flagged',
    actor: 'reviewer',
    cost: 0.03,
    ref: '§4 — approval bypass',
    modelId: 'claude-opus-4-7',
    promptHash: '0x12bf',
    body: 'The approveVendor handler reads manager_id from req.body. A caller can override the session manager. Constraint must be: manager_id := session.user.id, ignore body field.',
    prompt: 'Review §4 against the implementation in routes/approvals.ts. Return verdict (pass / flag) with the specific constraint that fails if any.',
    response: 'flag\n\nIn routes/approvals.ts, approveVendor(req) destructures manager_id from req.body. The session manager is available at req.session.user.id but is unused. A caller can submit any manager_id. The clause requires manager_id := session.user.id with the body field ignored.',
  },
  { t: '14:34:22', kind: 'gate_paused', actor: 'orchestrator', cost: 0, ref: 'builder for §4' },
  {
    t: '14:34:42',
    kind: 'builder_retried',
    actor: 'builder',
    cost: 0.07,
    ref: '§4',
    modelId: 'claude-opus-4-7',
    promptHash: '0x3b4d',
    prompt: 'Reviewer flagged §4. Constraint: manager_id := session.user.id, do not read from request body. Patch routes/approvals.ts.',
    response: 'Patched approveVendor: removed body destructure, sourced manager_id from req.session.user.id, added kairos:clause=§4 anchor on the function.',
  },
  {
    t: '14:35:11',
    kind: 'reviewer_verdict',
    actor: 'reviewer',
    cost: 0.04,
    ref: '§4: pass',
    modelId: 'claude-opus-4-7',
    promptHash: '0xae51',
    prompt: 'Re-review §4 against routes/approvals.ts after the builder retry.',
    response: 'pass — manager_id is now sourced from req.session.user.id and the body field is ignored. Anchor kairos:clause=§4 is present on the handler.',
  },
  {
    t: '14:36:00',
    kind: 'evals_run',
    actor: 'eval-runner',
    cost: 0.05,
    ref: '12/12',
    modelId: 'claude-opus-4-7',
    promptHash: '0x7f9c',
    prompt: 'Run all eval cases against the current build artifact tree. Report pass/fail per case.',
    response: '12/12 pass. §4 cases (E7, E8) confirm session-only manager_id and reject body override. §6 cases (E11, E12) confirm COI-expiry and MSA-presence gates.',
  },
  { t: '14:36:08', kind: 'reviewer_agreed', actor: 'reviewer', cost: 0, modelId: '—' },
  { t: '14:36:12', kind: 'build_sealed', actor: 'orchestrator', cost: 0, modelId: '—' },
]

export const AUDIT_EVENTS: AuditEvent[] = RAW_AUDIT_EVENTS.map((e, i, all) => {
  const id = `evt-${String(i + 1).padStart(3, '0')}`
  const auditHash = `0x${(0xa3f1 + i * 0x97 + e.t.length).toString(16).padStart(4, '0')}${id.slice(-3)}`
  const prevHash = i === 0 ? null : `0x${(0xa3f1 + (i - 1) * 0x97 + all[i - 1].t.length).toString(16).padStart(4, '0')}evt-${String(i).padStart(3, '0')}`.slice(0, 13)
  return { ...e, id, auditHash, prevHash }
})

export function findAuditEvent(id: string): AuditEvent | undefined {
  return AUDIT_EVENTS.find((e) => e.id === id)
}

export const RECONCILE_ITEMS: ReconcileItem[] = [
  {
    id: 'R-002',
    direction: 'code_to_spec',
    detected: '2026-04-25T15:42:00Z',
    summary: 'New field "preferred_currency" added to schemas/vendor.ts outside the platform. Proposing spec delta to §1.',
    diffPath: 'reconciler/proposals/R-002.patch',
    status: 'pending',
  },
]

export const PROJECTS: Project[] = [PROJECT]
