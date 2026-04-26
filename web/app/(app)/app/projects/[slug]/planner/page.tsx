import type { Metadata } from 'next'
import Link from 'next/link'
import { ThreePane } from '@/components/app/three-pane'
import { AgentRail } from '@/components/app/agent-rail'
import { StatusPill } from '@/components/ui/status-pill'
import { EmptyState } from '@/components/ui/empty-state'
import { PROJECT, WORK_ORDERS, type WorkOrderStatus } from '@/lib/app-data'

export const metadata: Metadata = {
  title: 'Planner',
  description: 'Work orders grouped by phase. Status, assignee, proof status at a glance.',
}

const PHASE_ORDER = ['discovery', 'design', 'implementation', 'verification', 'release'] as const
const PHASE_LABEL: Record<(typeof PHASE_ORDER)[number], string> = {
  discovery: 'Discovery',
  design: 'Design',
  implementation: 'Implementation',
  verification: 'Verification',
  release: 'Release',
}

export default function PlannerPage() {
  const grouped = PHASE_ORDER.map((phase) => ({
    phase,
    items: WORK_ORDERS.filter((wo) => wo.phase === phase),
  })).filter((g) => g.items.length > 0)

  const statusCounts = WORK_ORDERS.reduce<Record<WorkOrderStatus, number>>(
    (acc, wo) => {
      acc[wo.status] = (acc[wo.status] ?? 0) + 1
      return acc
    },
    { todo: 0, in_progress: 0, in_review: 0, blocked: 0, done: 0 },
  )

  return (
    <ThreePane
      id="planner"
      left={
        <div className="flex flex-col py-3">
          <div className="px-4 pb-2 text-[10px] uppercase tracking-widest text-subtle">
            Filters
          </div>
          <div className="px-4 space-y-2 text-sm">
            <FilterRow label="My work" disabled />
            <FilterRow label="Open only" disabled />
            <FilterRow label="With proof gaps" disabled />
            <FilterRow label="Has flagged comments" disabled />
          </div>

          <div className="mt-6 px-4 pb-2 text-[10px] uppercase tracking-widest text-subtle">
            Status
          </div>
          <ul className="px-4 space-y-1.5 text-xs">
            {(['todo', 'in_progress', 'in_review', 'blocked', 'done'] as const).map((s) => (
              <li key={s} className="flex items-center justify-between gap-2">
                <StatusPill kind={s} />
                <span className="font-mono text-muted">{statusCounts[s] ?? 0}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 px-4 text-[11px] text-subtle leading-relaxed">
            Search, group-by, and saved views land next batch.
          </p>
        </div>
      }
      center={
        <div className="px-5 md:px-8 py-6 md:py-8">
          <header className="flex items-baseline justify-between mb-6">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-subtle">Planner</div>
              <h1 className="font-serif text-2xl tracking-tight mt-1.5">Work orders</h1>
              <p className="mt-1 text-sm text-muted">
                {WORK_ORDERS.length} total · grouped by phase
              </p>
            </div>
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-surface transition-colors disabled:opacity-50"
            >
              + New work order (M3)
            </button>
          </header>

          {grouped.length === 0 ? (
            <EmptyState title="No work orders yet" body="Open one from a requirement or a blueprint." />
          ) : (
            <div className="space-y-8">
              {grouped.map((group) => (
                <section key={group.phase}>
                  <div className="flex items-baseline gap-3 mb-2">
                    <h2 className="font-serif text-base tracking-tight">{PHASE_LABEL[group.phase]}</h2>
                    <span className="font-mono text-[11px] text-subtle">
                      {group.items.length}
                    </span>
                  </div>
                  <ul className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                    {group.items.map((wo) => (
                      <li key={wo.id}>
                        <Link
                          href={`/app/projects/${PROJECT.slug}/planner/${wo.id}`}
                          className="grid grid-cols-[80px,1fr,auto,auto,auto] items-center gap-4 px-4 py-3 hover:bg-surface/50 transition-colors"
                        >
                          <span className="font-mono text-[11px] text-subtle">{wo.id}</span>
                          <span className="font-serif text-sm text-fg truncate">
                            {wo.title}
                          </span>
                          <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-mono text-muted">
                            {wo.assignee ? (
                              <>
                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-[10px]">
                                  {wo.assignee.initials}
                                </span>
                                <span className="text-fg">{wo.assignee.name}</span>
                              </>
                            ) : (
                              <span className="text-subtle">unassigned</span>
                            )}
                          </span>
                          <StatusPill kind={wo.status} />
                          <StatusPill kind={wo.proofStatus} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <div className="mt-10 rounded-lg border border-dashed border-border p-5">
            <div className="text-[10px] uppercase tracking-widest text-subtle">Banner slot</div>
            <p className="mt-1.5 text-sm text-fg">
              "Blueprints updated → 2 work orders may need review." Banner component renders here
              when blueprint changes are detected — wired in the next batch.
            </p>
          </div>
        </div>
      }
      right={
        <AgentRail
          title="Planner agent"
          banner={{
            tone: 'warn',
            text: 'WO-006 blocked on counsel review. Proposed unblock paths available.',
          }}
          pinned={[
            { id: 'WO-003', kind: 'work-order', label: 'Audit on status transitions' },
            { id: 'WO-006', kind: 'work-order', label: 'PII tombstone policy' },
          ]}
        />
      }
    />
  )
}

function FilterRow({ label, disabled }: { label: string; disabled?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-2 text-muted">
      <span className="flex items-center gap-2">
        <input
          type="checkbox"
          disabled={disabled}
          className="rounded border-border accent-fg disabled:opacity-50"
        />
        {label}
      </span>
    </label>
  )
}
