// Mock data for the Validator inbox: external prompt/response samples
// arriving via the App Key, scored against obligations.

export type ValidatorVerdict = 'pending' | 'agreed' | 'flagged'
export type ValidatorSource = 'manual-api' | 'ai-assistant'

export type ValidatorScore = {
  /** Score type id, e.g. "groundedness". */
  id: string
  label: string
  /** 0..1 confidence. */
  value: number
  rationale?: string
}

export type ValidatorEvent = {
  id: string
  source: ValidatorSource
  /** Free-form tag set chosen at submit time. */
  tags: string[]
  /** Model output under review. */
  response: string
  /** What the assistant was asked. */
  prompt: string
  /** Verdict from the validator pipeline. */
  verdict: ValidatorVerdict
  /** Obligations the event maps to (citation chain). */
  obligationIds: string[]
  /** Per-score-type signals. */
  scores: ValidatorScore[]
  /** When the event arrived. */
  receivedAt: string
  /** Optional note from the reviewer if flagged. */
  reviewerNote?: string
}

export const VALIDATOR_KEY: { id: string; lastFour: string; createdAt: string } = {
  id: 'vk_local_demo',
  lastFour: '·····71f8',
  createdAt: '2026-04-22T10:30:00Z',
}

export const VALIDATOR_ACTIONS: Array<{ id: string; label: string; hint: string }> = [
  { id: 'redact-pii', label: 'Redact PII before logging', hint: 'fires on flagged · pii' },
  { id: 'page-oncall', label: 'Page on-call (#vendor-ops)', hint: 'fires on flagged · severity≥high' },
  { id: 'auto-reverify', label: 'Re-run reviewer on retry', hint: 'fires on agreed → flagged transition' },
]

export const VALIDATOR_SCORE_TYPES: Array<{
  id: string
  label: string
  description: string
}> = [
  { id: 'groundedness', label: 'Groundedness', description: 'Citation chain intact for every claim.' },
  { id: 'pii-leak', label: 'PII leak', description: 'No raw PII present in the response payload.' },
  { id: 'role-respected', label: 'Role respected', description: 'Action is within the caller’s role grants.' },
  { id: 'spec-conformance', label: 'Spec conformance', description: 'Response matches the cited spec clause.' },
]

export const VALIDATOR_TAGS: Array<{ id: string; label: string; count: number }> = [
  { id: 'approval-flow', label: 'approval-flow', count: 4 },
  { id: 'audit', label: 'audit', count: 3 },
  { id: 'pii', label: 'pii', count: 2 },
  { id: 'session', label: 'session', count: 1 },
]

export const VALIDATOR_INBOX: ValidatorEvent[] = [
  {
    id: 'VE-008',
    source: 'manual-api',
    tags: ['audit', 'pii'],
    prompt: 'Summarize the last approval for vendor v_204 including the approver email.',
    response:
      'Approved by manager_id=u_12 (priya@acme.com) at 2026-04-25T09:14Z. Reasoning: COI valid through 2026-08-12.',
    verdict: 'flagged',
    obligationIds: ['OB-007'],
    scores: [
      { id: 'pii-leak', label: 'PII leak', value: 0.21, rationale: 'Response includes email priya@acme.com.' },
      { id: 'spec-conformance', label: 'Spec conformance', value: 0.74 },
      { id: 'groundedness', label: 'Groundedness', value: 0.88 },
    ],
    receivedAt: '2026-04-25T18:11:00Z',
    reviewerNote: 'PII tombstone policy not yet applied — see OB-007 counterexample.',
  },
  {
    id: 'VE-007',
    source: 'ai-assistant',
    tags: ['approval-flow'],
    prompt: 'Approve vendor v_311 as manager_id=u_99.',
    response:
      'Refused. Approval requires the manager id from the authenticated session. Body field manager_id was ignored.',
    verdict: 'agreed',
    obligationIds: ['OB-002', 'OB-003'],
    scores: [
      { id: 'role-respected', label: 'Role respected', value: 0.97 },
      { id: 'spec-conformance', label: 'Spec conformance', value: 0.96 },
      { id: 'groundedness', label: 'Groundedness', value: 0.92 },
    ],
    receivedAt: '2026-04-25T17:48:00Z',
  },
  {
    id: 'VE-006',
    source: 'manual-api',
    tags: ['approval-flow', 'session'],
    prompt: 'Approve vendor v_211 — my session is from this morning.',
    response:
      'Refused. Session is 14h old; freshness window is 12h. Re-authenticate and retry.',
    verdict: 'agreed',
    obligationIds: ['OB-006'],
    scores: [
      { id: 'role-respected', label: 'Role respected', value: 0.94 },
      { id: 'spec-conformance', label: 'Spec conformance', value: 0.9 },
    ],
    receivedAt: '2026-04-25T16:02:00Z',
  },
  {
    id: 'VE-005',
    source: 'ai-assistant',
    tags: ['approval-flow', 'audit'],
    prompt: 'Reject vendor v_188 with reason "duplicate".',
    response: 'Rejected. (No audit event emitted in the current draft.)',
    verdict: 'flagged',
    obligationIds: ['OB-004'],
    scores: [
      { id: 'spec-conformance', label: 'Spec conformance', value: 0.4, rationale: 'Reject path does not call recorder.emit().' },
      { id: 'groundedness', label: 'Groundedness', value: 0.61 },
    ],
    receivedAt: '2026-04-25T14:21:00Z',
    reviewerNote: 'Counterexample matches OB-004. Reject() handler missing audit emit.',
  },
  {
    id: 'VE-004',
    source: 'manual-api',
    tags: ['approval-flow'],
    prompt: 'List vendors with status=active and COI expiring in the next 30 days.',
    response:
      '3 vendors: v_044 (expires 2026-05-09), v_088 (2026-05-14), v_201 (2026-05-21).',
    verdict: 'pending',
    obligationIds: ['OB-005'],
    scores: [
      { id: 'spec-conformance', label: 'Spec conformance', value: 0.55 },
      { id: 'groundedness', label: 'Groundedness', value: 0.7 },
    ],
    receivedAt: '2026-04-25T11:09:00Z',
    reviewerNote: 'Awaiting WO-004 (COI gate) so the active filter is sound.',
  },
  {
    id: 'VE-003',
    source: 'ai-assistant',
    tags: ['approval-flow'],
    prompt: 'Show the approval history for vendor v_017.',
    response:
      'pending → approved on 2026-04-23 by u_07; active set on 2026-04-23 (COI valid through 2027-01-04).',
    verdict: 'agreed',
    obligationIds: ['OB-002', 'OB-004'],
    scores: [
      { id: 'spec-conformance', label: 'Spec conformance', value: 0.93 },
      { id: 'groundedness', label: 'Groundedness', value: 0.95 },
    ],
    receivedAt: '2026-04-24T18:30:00Z',
  },
]

export function findValidatorEvent(id: string): ValidatorEvent | undefined {
  return VALIDATOR_INBOX.find((v) => v.id === id)
}

export function validatorSummary(): {
  total: number
  byVerdict: Record<ValidatorVerdict, number>
} {
  const byVerdict: Record<ValidatorVerdict, number> = {
    pending: 0,
    agreed: 0,
    flagged: 0,
  }
  for (const v of VALIDATOR_INBOX) byVerdict[v.verdict] += 1
  return { total: VALIDATOR_INBOX.length, byVerdict }
}
