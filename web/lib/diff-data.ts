// Three-way diff seed data for the headline screen.
// Spec ↔ Code ↔ Proof. Right pane is a discriminated union so the prose
// counterexample case (OB-007) and the future code-vs-code agreed case
// share a single layout from day one.

export type LineStatus =
  | 'discharged'
  | 'partial'
  | 'unproven'
  | 'stale'
  | 'flagged'
  | 'unspec'
  | 'na'

export type LineMeta = {
  status: LineStatus
  clauseId?: string
  obligationId?: string
  reason?: string
}

export type CodeLine = {
  text: string
  meta: LineMeta
}

export type CodeRange = {
  start: number // 1-based inclusive
  end: number // 1-based inclusive
}

export type SpecClause = {
  id: string
  title: string
  body: string
  obligationIds: string[]
  /** Builder line ranges that satisfy or relate to this clause. */
  relatedRanges?: CodeRange[]
}

export type CounterexampleStep = {
  id: string
  label: string
  /** Optional pointer back into the builder pane. */
  range?: CodeRange
  detail?: string
}

export type CounterexampleMockResponses = {
  /** Per-step.id canned response for "Explain". Falls back to a template. */
  explain?: Record<string, string>
  /** Per-step.id canned response for "Propose fix". Falls back to a template. */
  proposeFix?: Record<string, string>
  /** Single canned response for "Shrink". Falls back to a template. */
  shrink?: string
}

export type Counterexample = {
  summary: string
  affectedFiles: string[]
  /** Line ranges in the builder pane that the counterexample implicates. */
  affectedRanges: CodeRange[]
  steps: CounterexampleStep[]
  obligationIds: string[]
  /** Canned mock-agent responses keyed by chip + step. */
  mockResponses?: CounterexampleMockResponses
}

export type ReviewerPaneContent =
  | { kind: 'agreed'; verdicts: Array<{ clauseId: string; note: string }> }
  | { kind: 'flagged'; counterexample: Counterexample }
  | { kind: 'pending'; reason: string }

export type DiffSeed = {
  workOrderId: string
  builderFile: string
  builderLines: CodeLine[]
  specClauses: SpecClause[]
  reviewer: ReviewerPaneContent
  generatedAt: string
}

const LINE = (text: string, meta: LineMeta = { status: 'na' }): CodeLine => ({
  text,
  meta,
})

export const WO_003_DIFF: DiffSeed = {
  workOrderId: 'WO-003',
  builderFile: 'audit/recorder.ts',
  generatedAt: '2026-04-25T09:21:00Z',
  builderLines: [
    LINE('// kairos:clause=§A', { status: 'discharged', clauseId: '§A' }),
    LINE('// Records audit events for vendor lifecycle transitions.'),
    LINE('// OB-004: every transition emits an event.'),
    LINE('// OB-007: events MUST NOT contain PII fields.'),
    LINE(''),
    LINE("import type { Vendor } from '../schemas/vendor'"),
    LINE("import { writeAuditEvent } from './writer'"),
    LINE(''),
    LINE('type Actor = {'),
    LINE('  id: string'),
    LINE('  email: string', {
      status: 'partial',
      obligationId: 'OB-007',
      reason: 'PII field reaches the recorder; safe at this layer if filtered before write.',
    }),
    LINE('  legal_name?: string', {
      status: 'partial',
      obligationId: 'OB-007',
      reason: 'PII field reaches the recorder; safe at this layer if filtered before write.',
    }),
    LINE('}'),
    LINE(''),
    LINE('// kairos:clause=§A', { status: 'discharged', clauseId: '§A' }),
    LINE('export function recordTransition('),
    LINE('  vendor: Vendor,'),
    LINE('  from: string,'),
    LINE('  to: string,'),
    LINE('  actor: Actor,'),
    LINE('): void {'),
    LINE('  writeAuditEvent({'),
    LINE("    kind: 'vendor.status_changed',"),
    LINE('    vendor_id: vendor.id,'),
    LINE('    from,'),
    LINE('    to,'),
    LINE('    actor_id: actor.id,'),
    LINE('    actor_email: actor.email,', {
      status: 'flagged',
      obligationId: 'OB-007',
      reason: 'PII written directly into the audit chain. Tombstone pattern not applied.',
    }),
    LINE('    actor_legal_name: actor.legal_name,', {
      status: 'flagged',
      obligationId: 'OB-007',
      reason: 'PII written directly into the audit chain. Tombstone pattern not applied.',
    }),
    LINE('    t: new Date().toISOString(),'),
    LINE('  })'),
    LINE('}'),
    LINE(''),
    LINE('// kairos:clause=§A', { status: 'discharged', clauseId: '§A' }),
    LINE('export function recordRejection('),
    LINE('  vendor: Vendor,'),
    LINE('  reason: string,'),
    LINE('  actor: Actor,'),
    LINE('): void {', {
      status: 'flagged',
      obligationId: 'OB-004',
      reason: 'No call to writeAuditEvent. The pending → rejected transition is invisible.',
    }),
    LINE('  // intentional gap: should call writeAuditEvent', {
      status: 'flagged',
      obligationId: 'OB-004',
      reason: 'Audit emit missing for the reject path.',
    }),
    LINE('  //   with from="pending", to="rejected"', {
      status: 'flagged',
      obligationId: 'OB-004',
      reason: 'Audit emit missing for the reject path.',
    }),
    LINE('}'),
    LINE(''),
    LINE('// Open question: tombstone strategy for PII fields above?', {
      status: 'unspec',
      reason: 'No clause anchors the tombstone strategy yet. Refinery owes a clause here.',
    }),
  ],
  specClauses: [
    {
      id: '§A',
      title: 'Audit on every status transition',
      body:
        'Every vendor status transition (draft → pending → approved | rejected | active) emits an audit event capturing prior status, new status, actor id, and timestamp.',
      obligationIds: ['OB-004'],
      relatedRanges: [
        { start: 1, end: 1 },
        { start: 16, end: 32 },
        { start: 35, end: 42 },
      ],
    },
    {
      id: '§B',
      title: 'PII tombstone in audit chain',
      body:
        'Audit events MUST NOT contain PII fields directly. PII is stored in a separate erasable store keyed by event id; the chain holds the key, not the value.',
      obligationIds: ['OB-007'],
      relatedRanges: [
        { start: 11, end: 12 },
        { start: 28, end: 29 },
      ],
    },
    {
      id: '§C',
      title: 'Rejection emits the same shape as approval',
      body:
        'recordRejection MUST emit the same audit event shape as recordTransition with to="rejected". This is what reconciles the chain when an auditor reads pending → rejected paths.',
      obligationIds: ['OB-004'],
      relatedRanges: [{ start: 35, end: 42 }],
    },
  ],
  reviewer: {
    kind: 'flagged',
    counterexample: {
      summary:
        'Two structural issues against §A and §B. The recorder emits PII directly into the chain, and the reject path produces no audit event at all — so a vendor that goes draft → pending → rejected appears in the chain only as draft → pending.',
      affectedFiles: ['audit/recorder.ts', 'routes/approvals.ts'],
      affectedRanges: [
        { start: 28, end: 29 },
        { start: 39, end: 41 },
      ],
      obligationIds: ['OB-004', 'OB-007'],
      steps: [
        {
          id: 'S1',
          label: 'Approver rejects vendor V-100 with reason "incomplete COI"',
          detail: 'POST /vendors/V-100/reject with role=approver, body { reason: "incomplete COI" }',
        },
        {
          id: 'S2',
          label: 'Handler routes/approvals.ts:reject() runs and returns 200',
          detail: 'No call to recorder. Status goes pending → rejected silently.',
        },
        {
          id: 'S3',
          label: 'recordRejection() exists but is a no-op',
          range: { start: 39, end: 41 },
          detail: 'Body is comments only — the OB-004 hole.',
        },
        {
          id: 'S4',
          label: 'Audit chain holds no record of pending → rejected',
          detail: 'Compliance pack export shows V-100 stuck at pending forever.',
        },
        {
          id: 'S5',
          label: 'Auditor reconstructs lifecycle and finds a hole',
          detail: 'OB-004 reproduced with a single rejected vendor. Likewise OB-007 once a transition emits successfully — actor_email is in the payload.',
        },
      ],
      mockResponses: {
        shrink:
          'Minimal failing trace is two steps. Step 1: a single rejected vendor. Step 3: recordRejection’s body is comments only. The other steps are corollary — they add narrative but don’t add failure conditions. OB-004 reproduces with just S1 and S3.',
        explain: {
          S1: 'Step 1 sets up the input that drives the rest of the trace: a vendor V-100 in status=pending getting rejected. The reject is permitted by the role check (the approver has the role), so this is the lawful caller, not a privilege escalation. The failure is downstream.',
          S2: 'Step 2 is where the chain integrity quietly breaks. The reject handler returns 200 to the caller; the database row flips to status=rejected; nothing in audit/recorder.ts gets called. From the outside the operation looks fine, which is exactly why this is the kind of bug a reviewer agent has to catch — there is no runtime error to surface.',
          S3: 'Step 3 is the OB-004 hole made literal. recordRejection is defined and exported, so calling code expects an audit entry. The body is comments only. This isn’t a TODO that fails CI — it’s a function that succeeds silently. That’s the worst kind of audit gap because the symptom is absence.',
          S4: 'Step 4 is the consequence at the data layer. The audit chain’s last entry for V-100 is the pending transition. There is no pending → rejected entry. The chain remains internally consistent (each event hashes correctly) but the chain is incomplete relative to reality.',
          S5: 'Step 5 is what the buyer cares about. An auditor reconstructs the vendor lifecycle from the audit pack and finds V-100 stuck at pending with no terminal state. They can’t answer "was this vendor rejected?" from the chain alone. OB-004 is reproduced with a single rejected vendor and one missing emit.',
        },
        proposeFix: {
          S3: 'Replace L39–L41 with: writeAuditEvent({ kind: "vendor.status_changed", vendor_id: vendor.id, from: "pending", to: "rejected", actor_id: actor.id, t: new Date().toISOString() }). Anchor with kairos:clause=§C above the function. Discharges OB-004 on the reject path. The §B PII obligation still needs the tombstone pattern at L28–L29 — separate WO.',
        },
      },
    },
  },
}

export const WO_002_DIFF: DiffSeed = {
  workOrderId: 'WO-002',
  builderFile: 'routes/approvals.ts',
  generatedAt: '2026-04-24T09:16:00Z',
  builderLines: [
    LINE("import type { Request, Response } from '../http'"),
    LINE("import type { Vendor } from '../schemas/vendor'"),
    LINE("import { canApprove } from '../auth/policies'"),
    LINE("import { recordTransition } from '../audit/recorder'"),
    LINE("import { vendorRepo } from '../db/vendors'"),
    LINE(''),
    LINE('// kairos:clause=§3', { status: 'discharged', clauseId: '§3' }),
    LINE('export async function approveVendor('),
    LINE('  req: Request,'),
    LINE('  res: Response,'),
    LINE('): Promise<Response> {'),
    LINE('  if (!canApprove(req.session)) return res.status(403)', {
      status: 'discharged',
      clauseId: '§3',
    }),
    LINE('  const vendor = await vendorRepo.byId(req.params.id)'),
    LINE('  if (!vendor) return res.status(404)'),
    LINE("  if (vendor.status !== 'pending') return res.status(409)"),
    LINE(''),
    LINE('  // kairos:clause=§4 — manager_id from session, body ignored', {
      status: 'discharged',
      clauseId: '§4',
    }),
    LINE('  const managerId = req.session.user.id', {
      status: 'discharged',
      clauseId: '§4',
    }),
    LINE(''),
    LINE('  const updated = await vendorRepo.update(vendor.id, {'),
    LINE("    status: 'approved',"),
    LINE('    manager_id: managerId,', {
      status: 'discharged',
      clauseId: '§4',
    }),
    LINE('  })'),
    LINE(''),
    LINE("  recordTransition(updated, 'pending', 'approved', req.session.user)", {
      status: 'discharged',
      clauseId: '§3',
    }),
    LINE('  return res.json(updated)'),
    LINE('}'),
    LINE(''),
    LINE('// kairos:clause=§3', { status: 'discharged', clauseId: '§3' }),
    LINE('export async function rejectVendor('),
    LINE('  req: Request,'),
    LINE('  res: Response,'),
    LINE('): Promise<Response> {'),
    LINE('  if (!canApprove(req.session)) return res.status(403)', {
      status: 'discharged',
      clauseId: '§3',
    }),
    LINE('  const vendor = await vendorRepo.byId(req.params.id)'),
    LINE('  if (!vendor) return res.status(404)'),
    LINE("  if (vendor.status !== 'pending') return res.status(409)"),
    LINE(''),
    LINE('  const updated = await vendorRepo.update(vendor.id, {'),
    LINE("    status: 'rejected',"),
    LINE('  })'),
    LINE(''),
    LINE("  recordTransition(updated, 'pending', 'rejected', req.session.user)", {
      status: 'discharged',
      clauseId: '§3',
    }),
    LINE('  return res.json(updated)'),
    LINE('}'),
  ],
  specClauses: [
    {
      id: '§3',
      title: 'Approver role enforced at handler',
      body:
        'Both approve and reject mutations require role=approver. The check runs on the route handler before any vendor read or status mutation.',
      obligationIds: ['OB-003'],
      relatedRanges: [
        { start: 7, end: 12 },
        { start: 29, end: 34 },
      ],
    },
    {
      id: '§4',
      title: 'Approval requires session manager_id',
      body:
        'manager_id is sourced from req.session.user.id on approve. The request body cannot override the session manager.',
      obligationIds: ['OB-002'],
      relatedRanges: [
        { start: 17, end: 18 },
        { start: 23, end: 23 },
      ],
    },
  ],
  reviewer: {
    kind: 'agreed',
    verdicts: [
      {
        clauseId: '§3',
        note:
          'canApprove(req.session) gates both handlers as the first statement. Non-approvers receive 403 before any data is read or status mutated.',
      },
      {
        clauseId: '§4',
        note:
          'managerId is bound to req.session.user.id at line 18 and used at line 23. The body field destructure was removed in the §4 retry; req.body.manager_id is never read.',
      },
    ],
  },
}

export const WO_004_DIFF: DiffSeed = {
  workOrderId: 'WO-004',
  builderFile: 'lib/compliance.ts',
  generatedAt: '2026-04-25T15:11:00Z',
  builderLines: [
    LINE('// kairos:clause=§D draft scaffold', {
      status: 'unproven',
      clauseId: '§D',
      reason: 'Builder is still drafting. Reviewer has not produced a verdict yet.',
    }),
    LINE("import type { Vendor } from '../schemas/vendor'"),
    LINE(''),
    LINE('// kairos:clause=§D', {
      status: 'unproven',
      clauseId: '§D',
    }),
    LINE('export function isCoiValid(vendor: Vendor, now: Date): boolean {'),
    LINE('  // TODO: parse vendor.coi_expiry as date, compare to now', {
      status: 'unproven',
      clauseId: '§D',
      reason: 'Implementation is a placeholder; no real comparison yet.',
    }),
    LINE('  return true  // placeholder', {
      status: 'unproven',
      clauseId: '§D',
      reason: 'Always returns true. The eval cases for §D will fail against this.',
    }),
    LINE('}'),
    LINE(''),
    LINE('// kairos:clause=§E', {
      status: 'unproven',
      clauseId: '§E',
    }),
    LINE('export function canActivate(vendor: Vendor, now: Date): boolean {'),
    LINE('  if (!isCoiValid(vendor, now)) return false', {
      status: 'unproven',
      clauseId: '§D',
    }),
    LINE('  if (!vendor.msa_url) return false', {
      status: 'unproven',
      clauseId: '§E',
    }),
    LINE('  return true'),
    LINE('}'),
    LINE(''),
    LINE('// TODO: routes/vendors.ts:setStatus needs to call canActivate', {
      status: 'unspec',
      reason: 'No clause yet covers the wiring point. Refinery owes a clause anchoring the route.',
    }),
    LINE("//       before allowing status='active'", {
      status: 'unspec',
      reason: 'Wire-in step is unspec’d.',
    }),
  ],
  specClauses: [
    {
      id: '§D',
      title: 'Active requires unexpired COI',
      body:
        'A vendor cannot reach status=active if vendor.coi_expiry is in the past. The check must run on the route handler before any persisted status change.',
      obligationIds: ['OB-005'],
      relatedRanges: [
        { start: 4, end: 8 },
        { start: 12, end: 12 },
      ],
    },
    {
      id: '§E',
      title: 'Active requires non-empty MSA',
      body:
        'A vendor cannot reach status=active if vendor.msa_url is empty.',
      obligationIds: ['OB-005'],
      relatedRanges: [{ start: 10, end: 13 }],
    },
  ],
  reviewer: {
    kind: 'pending',
    reason:
      'Builder is still drafting lib/compliance.ts. The current isCoiValid stub always returns true and the route wire-in is a TODO comment. Re-run reviewer when the wire-in lands.',
  },
}

export const DIFF_SEEDS: Record<string, DiffSeed> = {
  'WO-002': WO_002_DIFF,
  'WO-003': WO_003_DIFF,
  'WO-004': WO_004_DIFF,
}

export function findDiffSeed(workOrderId: string): DiffSeed | undefined {
  return DIFF_SEEDS[workOrderId]
}
