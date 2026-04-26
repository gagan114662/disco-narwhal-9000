// Synthesizes a spec → planner → diff → proof lineage for an obligation.
// Pure data — same swap-to-API path as app-data.ts.

import {
  BLUEPRINTS,
  OBLIGATIONS,
  REQUIREMENTS,
  WORK_ORDERS,
  type Obligation,
  type Requirement,
  type Blueprint,
  type WorkOrder,
  type EvidenceItem,
} from './app-data'
import { findDiffSeed, type DiffSeed } from './diff-data'

export type ProvenanceStage = 'spec' | 'planner' | 'diff' | 'proof'

export type ProvenanceNode =
  | {
      stage: 'spec'
      kind: 'requirement'
      id: string
      title: string
      detail: string
      t?: string
      requirement: Requirement
    }
  | {
      stage: 'spec'
      kind: 'blueprint'
      id: string
      title: string
      detail: string
      t?: string
      blueprint: Blueprint
    }
  | {
      stage: 'planner'
      kind: 'work-order'
      id: string
      title: string
      detail: string
      t: string
      workOrder: WorkOrder
    }
  | {
      stage: 'diff'
      kind: 'diff'
      id: string
      title: string
      detail: string
      t: string
      workOrderId: string
      diff: DiffSeed
    }
  | {
      stage: 'proof'
      kind: 'evidence'
      id: string
      title: string
      detail: string
      t: string
      evidence: EvidenceItem
    }

export type Provenance = {
  obligation: Obligation
  nodes: ProvenanceNode[]
}

/**
 * Build the lineage that earned (or failed to earn) the obligation.
 * Order: spec sources → work orders → diffs → evidence, sorted within
 * each stage by what we know.
 */
export function buildProvenanceForObligation(obligationId: string): Provenance | null {
  const ob = OBLIGATIONS.find((o) => o.id === obligationId)
  if (!ob) return null

  const reqs = REQUIREMENTS.filter((r) => r.obligationIds.includes(ob.id))
  const blueprints = BLUEPRINTS.filter((b) => b.obligationIds.includes(ob.id))
  const wos = WORK_ORDERS.filter((w) => w.obligationIds.includes(ob.id))

  const specNodes: ProvenanceNode[] = [
    ...reqs.map(
      (r): ProvenanceNode => ({
        stage: 'spec',
        kind: 'requirement',
        id: r.id,
        title: r.title,
        detail: r.body,
        requirement: r,
      }),
    ),
    ...blueprints.map(
      (b): ProvenanceNode => ({
        stage: 'spec',
        kind: 'blueprint',
        id: b.id,
        title: b.title,
        detail: b.prose,
        blueprint: b,
      }),
    ),
  ]

  const plannerNodes: ProvenanceNode[] = wos
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(
      (w): ProvenanceNode => ({
        stage: 'planner',
        kind: 'work-order',
        id: w.id,
        title: w.title,
        detail: `${labelForStatus(w.status)} · ${w.phase}`,
        t: w.createdAt,
        workOrder: w,
      }),
    )

  const diffNodes: ProvenanceNode[] = wos
    .map((w) => {
      const d = findDiffSeed(w.id)
      if (!d) return null
      const verdict = labelForReviewer(d)
      return {
        stage: 'diff' as const,
        kind: 'diff' as const,
        id: `${w.id}-diff`,
        title: `${w.id} · ${d.builderFile}`,
        detail: verdict,
        t: d.generatedAt,
        workOrderId: w.id,
        diff: d,
      }
    })
    .filter((n): n is Extract<ProvenanceNode, { stage: 'diff' }> => n !== null)
    .sort((a, b) => a.t.localeCompare(b.t))

  const proofNodes: ProvenanceNode[] = (ob.evidence ?? [])
    .slice()
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt))
    .map(
      (e): ProvenanceNode => ({
        stage: 'proof',
        kind: 'evidence',
        id: e.id,
        title: e.label,
        detail: `${e.kind} · ${e.ref}`,
        t: e.addedAt,
        evidence: e,
      }),
    )

  return {
    obligation: ob,
    nodes: [...specNodes, ...plannerNodes, ...diffNodes, ...proofNodes],
  }
}

function labelForStatus(s: WorkOrder['status']): string {
  switch (s) {
    case 'todo':
      return 'todo'
    case 'in_progress':
      return 'in progress'
    case 'in_review':
      return 'in review'
    case 'blocked':
      return 'blocked'
    case 'done':
      return 'done'
  }
}

function labelForReviewer(d: DiffSeed): string {
  if (d.reviewer.kind === 'agreed') return `reviewer agreed · ${d.reviewer.verdicts.length} verdicts`
  if (d.reviewer.kind === 'flagged') return `reviewer flagged · ${d.reviewer.counterexample.steps.length} steps`
  return 'reviewer pending'
}
