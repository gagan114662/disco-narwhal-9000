import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DiffWorkspace } from '@/components/app/diff-workspace'
import { PROJECT, findObligation, findWorkOrder } from '@/lib/app-data'
import { findDiffSeed } from '@/lib/diff-data'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ woId: string }>
}): Promise<Metadata> {
  const { woId } = await params
  const wo = findWorkOrder(woId)
  if (!wo) return { title: 'Diff not found' }
  return {
    title: `${wo.id} · diff`,
    description: `Spec ↔ code ↔ proof for ${wo.title}.`,
  }
}

export default async function DiffPage({
  params,
}: {
  params: Promise<{ slug: string; woId: string }>
}) {
  const { slug, woId } = await params
  if (slug !== PROJECT.slug) notFound()
  const wo = findWorkOrder(woId)
  if (!wo) notFound()
  const diff = findDiffSeed(wo.id)
  if (!diff) {
    return (
      <div className="px-6 py-10 max-w-2xl">
        <div className="text-[10px] uppercase tracking-widest text-subtle">Diff</div>
        <h1 className="mt-2 font-serif text-2xl tracking-tight">
          No diff seeded for {wo.id}
        </h1>
        <p className="mt-3 text-sm text-muted">
          Three diffs ship today: WO-002 (agreed), WO-003 (flagged), WO-004 (pending). Other
          work orders get their seeds in a future batch.
        </p>
      </div>
    )
  }

  // Pin the WO + any obligations the reviewer cited (flagged) or the WO itself owns.
  const pinnedObligationIds =
    diff.reviewer.kind === 'flagged'
      ? diff.reviewer.counterexample.obligationIds
      : wo.obligationIds.slice(0, 2)
  const pinnedObligations = pinnedObligationIds
    .map((id) => findObligation(id))
    .filter((o): o is NonNullable<typeof o> => o !== undefined)

  // Banner reflects the reviewer state — this is the whole point of the rail
  // being on this surface.
  const banner =
    diff.reviewer.kind === 'flagged'
      ? {
          tone: 'error' as const,
          text: `Reviewer flagged ${diff.reviewer.counterexample.steps.length} step counterexample. Ask for a fix or a covering test.`,
        }
      : diff.reviewer.kind === 'pending'
        ? { tone: 'warn' as const, text: 'Reviewer hasn’t produced a verdict yet. Re-run after the next builder change.' }
        : { tone: 'info' as const, text: 'Reviewer agreed on every clause. Ask for a regression test or move on.' }

  const chips =
    diff.reviewer.kind === 'flagged'
      ? ['Propose fix', 'Generate covering test', 'Explain counterexample', 'Open OB drilldown']
      : diff.reviewer.kind === 'pending'
        ? ['Wire route call', 'Replace stub', 'Generate first test', 'Explain blocker']
        : ['Add regression test', 'Lock the verdicts', 'Explain decision', 'Open WO']

  return (
    <DiffWorkspace
      wo={wo}
      diff={diff}
      banner={banner}
      pinned={[
        { id: wo.id, kind: 'work-order', label: wo.title },
        { id: diff.builderFile, kind: 'file', label: diff.builderFile },
        ...pinnedObligations.map((o) => ({
          id: o.id,
          kind: 'obligation' as const,
          label: o.title,
        })),
      ]}
      chips={chips}
    />
  )
}
