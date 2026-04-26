// Computes a merge-gate verdict for a work order from obligations + diff state.
// Pure data — no React.

import {
  findObligation,
  type Obligation,
  type ProofStatus,
  type WorkOrder,
} from './app-data'
import { findDiffSeed, type DiffSeed } from './diff-data'

export type GateVerdict = 'pass' | 'warn' | 'block'

export type GateCheck = {
  id: string
  label: string
  detail: string
  verdict: GateVerdict
  /** Optional ref shown as a chip. */
  ref?: string
}

export type MergeGate = {
  workOrderId: string
  verdict: GateVerdict
  summary: string
  /** Number of checks per verdict. */
  counts: Record<GateVerdict, number>
  checks: GateCheck[]
  obligations: Obligation[]
  diff: DiffSeed | null
}

const STATUS_VERDICT: Record<ProofStatus, GateVerdict> = {
  discharged: 'pass',
  partial: 'warn',
  unproven: 'block',
  stale: 'warn',
}

const STATUS_DETAIL: Record<ProofStatus, string> = {
  discharged: 'evidence attached, reviewer agreed',
  partial: 'some evidence; counterexample still open',
  unproven: 'no evidence yet',
  stale: 'last evidence > 7 days old',
}

/**
 * Compute the gate. The verdict is the worst of:
 *   - any obligation that isn't discharged
 *   - the reviewer (flagged → block, pending → warn)
 *   - any blocking WO-level signal (status=blocked)
 */
export function computeMergeGate(wo: WorkOrder): MergeGate {
  const obligations = wo.obligationIds
    .map((id) => findObligation(id))
    .filter((o): o is Obligation => o !== undefined)
  const diff = findDiffSeed(wo.id) ?? null

  const checks: GateCheck[] = []

  if (wo.status === 'blocked') {
    checks.push({
      id: 'wo-blocked',
      label: 'Work order is blocked',
      detail: 'Resolve the blocker before merge can be considered.',
      verdict: 'block',
      ref: wo.id,
    })
  }

  for (const ob of obligations) {
    checks.push({
      id: `ob-${ob.id}`,
      label: `${ob.id} · ${ob.title}`,
      detail: STATUS_DETAIL[ob.status],
      verdict: STATUS_VERDICT[ob.status],
      ref: ob.id,
    })
  }

  if (diff) {
    if (diff.reviewer.kind === 'flagged') {
      checks.push({
        id: 'reviewer',
        label: 'Reviewer flagged a counterexample',
        detail: `${diff.reviewer.counterexample.steps.length}-step trace against ${diff.reviewer.counterexample.obligationIds.join(', ')}.`,
        verdict: 'block',
        ref: 'reviewer',
      })
    } else if (diff.reviewer.kind === 'pending') {
      checks.push({
        id: 'reviewer',
        label: 'Reviewer hasn’t produced a verdict',
        detail: 'Re-run the reviewer once the next builder change lands.',
        verdict: 'warn',
        ref: 'reviewer',
      })
    } else {
      checks.push({
        id: 'reviewer',
        label: 'Reviewer agreed on every clause',
        detail: `${diff.reviewer.verdicts.length} verdict${diff.reviewer.verdicts.length === 1 ? '' : 's'}.`,
        verdict: 'pass',
        ref: 'reviewer',
      })
    }
  } else {
    checks.push({
      id: 'reviewer',
      label: 'No diff seeded for this work order',
      detail: 'Reviewer cannot vote until a diff is produced.',
      verdict: 'warn',
    })
  }

  const filesPending = wo.files.filter((f) => f.status === 'pending').length
  if (filesPending > 0) {
    checks.push({
      id: 'files-pending',
      label: `${filesPending} file${filesPending === 1 ? '' : 's'} pending`,
      detail: 'Builder hasn’t produced a draft for these paths yet.',
      verdict: 'warn',
    })
  }

  const counts: Record<GateVerdict, number> = { pass: 0, warn: 0, block: 0 }
  for (const c of checks) counts[c.verdict] += 1

  const verdict: GateVerdict =
    counts.block > 0 ? 'block' : counts.warn > 0 ? 'warn' : 'pass'

  const summary =
    verdict === 'block'
      ? `Blocked by ${counts.block} check${counts.block === 1 ? '' : 's'}. Merge will be refused.`
      : verdict === 'warn'
        ? `${counts.warn} warning${counts.warn === 1 ? '' : 's'}. Merge allowed with override.`
        : 'All checks pass. Merge is clean.'

  return {
    workOrderId: wo.id,
    verdict,
    summary,
    counts,
    checks,
    obligations,
    diff,
  }
}
