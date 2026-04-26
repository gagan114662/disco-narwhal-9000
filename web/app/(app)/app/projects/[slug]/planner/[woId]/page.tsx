import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ThreePane } from '@/components/app/three-pane'
import { AgentRail } from '@/components/app/agent-rail'
import { WorkOrderDetail } from '@/components/app/work-order-detail'
import { StatusPill } from '@/components/ui/status-pill'
import {
  PROJECT,
  WORK_ORDERS,
  findBlueprint,
  findObligation,
  findRequirement,
  findWorkOrder,
} from '@/lib/app-data'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ woId: string }>
}): Promise<Metadata> {
  const { woId } = await params
  const wo = findWorkOrder(woId)
  if (!wo) return { title: 'Work order not found' }
  return {
    title: `${wo.id} · ${wo.title}`,
    description: wo.title,
  }
}

export default async function WorkOrderPage({
  params,
}: {
  params: Promise<{ slug: string; woId: string }>
}) {
  const { slug, woId } = await params
  if (slug !== PROJECT.slug) notFound()
  const wo = findWorkOrder(woId)
  if (!wo) notFound()

  const blueprint = wo.blueprintId ? (findBlueprint(wo.blueprintId) ?? null) : null
  const requirements = wo.requirementIds
    .map((id) => findRequirement(id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
  const obligations = wo.obligationIds
    .map((id) => findObligation(id))
    .filter((o): o is NonNullable<typeof o> => o !== undefined)

  const banner =
    wo.status === 'blocked'
      ? { tone: 'error' as const, text: `${wo.id} is blocked. Open the activity feed for the latest reason.` }
      : wo.proofStatus === 'unproven' || wo.proofStatus === 'stale'
        ? { tone: 'warn' as const, text: 'One or more obligations need attention. See the Proof tab.' }
        : { tone: 'info' as const, text: 'Pinned to this WO. Ask for a diff, a covering test, or an obligation explanation.' }

  return (
    <ThreePane
      id="planner-detail"
      left={
        <div className="flex flex-col py-3">
          <div className="px-4 pb-2 text-[10px] uppercase tracking-widest text-subtle">
            Work orders
          </div>
          <ul>
            {WORK_ORDERS.map((other) => {
              const active = other.id === wo.id
              return (
                <li key={other.id}>
                  <Link
                    href={`/app/projects/${PROJECT.slug}/planner/${other.id}`}
                    className={`flex items-start gap-3 px-4 py-2.5 text-sm border-l-2 transition-colors ${
                      active
                        ? 'border-accent bg-surface text-fg'
                        : 'border-transparent text-muted hover:text-fg hover:bg-surface/40'
                    }`}
                  >
                    <span className="font-mono text-[10px] text-subtle pt-0.5 w-12 flex-shrink-0">
                      {other.id}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-fg truncate text-[13px]">{other.title}</span>
                      <span className="mt-1 inline-flex gap-1.5">
                        <StatusPill kind={other.status} />
                        <StatusPill kind={other.proofStatus} />
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      }
      center={
        <WorkOrderDetail
          wo={wo}
          blueprint={blueprint}
          requirements={requirements}
          obligations={obligations}
        />
      }
      right={
        <AgentRail
          title="Work-order agent"
          banner={banner}
          pinned={[
            { id: wo.id, kind: 'work-order', label: wo.title },
            ...(blueprint ? [{ id: blueprint.id, kind: 'blueprint' as const, label: blueprint.title }] : []),
            ...obligations.slice(0, 2).map((o) => ({
              id: o.id,
              kind: 'obligation' as const,
              label: o.title,
            })),
          ]}
          chips={[
            'Re-verify proof',
            'Generate covering test',
            'Update file with AI',
            'Explain blueprint',
            'Open counterexample',
          ]}
        />
      }
    />
  )
}
