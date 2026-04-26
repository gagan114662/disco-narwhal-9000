import type { Metadata } from 'next'
import Link from 'next/link'
import { ThreePane } from '@/components/app/three-pane'
import { AgentRail } from '@/components/app/agent-rail'
import { KpiCard } from '@/components/ui/kpi-card'
import { StatusPill } from '@/components/ui/status-pill'
import { EmptyState } from '@/components/ui/empty-state'
import {
  COVERAGE,
  FLAGGED_COMMENTS,
  INDEXING,
  KPIS,
  OBLIGATIONS,
  PROJECT,
  REQUIREMENTS,
  WORK_ORDERS,
} from '@/lib/app-data'
import { formatDateTime } from '@/lib/format-time'

export const metadata: Metadata = {
  title: 'Overview',
  description:
    'Project KPIs, indexing status, pending work orders, flagged comments, and the coverage heatmap.',
}

const HEATMAP_COLOR: Record<string, string> = {
  discharged: 'bg-accent/80',
  partial: 'bg-amber-500/70',
  unproven: 'bg-fg/15',
  stale: 'bg-fg/30',
  na: 'bg-transparent',
}

export default function OverviewPage() {
  const pendingWOs = WORK_ORDERS.filter((wo) => wo.status !== 'done').slice(0, 5)

  return (
    <ThreePane
      id="overview"
      center={
        <div className="px-5 md:px-8 py-6 md:py-8 max-w-6xl">
          <header className="flex items-baseline justify-between gap-4 mb-6">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-subtle">Overview</div>
              <h1 className="font-serif text-2xl tracking-tight mt-1.5 text-balance">
                {PROJECT.name}
              </h1>
              <p className="mt-1 text-sm text-muted">{PROJECT.description}</p>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest text-subtle">archetype</div>
              <div className="font-mono text-[11px] text-muted">{PROJECT.archetype}</div>
            </div>
          </header>

          <section aria-label="Module KPIs">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {KPIS.map((kpi) => (
                <KpiCard key={kpi.module} kpi={kpi} />
              ))}
            </div>
          </section>

          <section aria-label="Indexing" className="mt-8 rounded-lg border border-border p-5">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-subtle">
                  Codebase indexing
                </div>
                <div className="mt-1 font-serif text-lg tracking-tight">{INDEXING.repo}</div>
                <div className="mt-0.5 font-mono text-[11px] text-muted">
                  branch <span className="text-fg">{INDEXING.branch}</span> ·{' '}
                  {INDEXING.files} files · {INDEXING.symbols} symbols ·{' '}
                  {(INDEXING.durationMs / 1000).toFixed(1)}s last sweep
                </div>
              </div>
              <StatusPill kind={INDEXING.status} />
            </div>
          </section>

          <section aria-label="Pending work orders" className="mt-8">
            <div className="flex items-baseline justify-between mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-subtle">
                  Pending work orders
                </div>
                <div className="mt-0.5 text-sm text-muted">
                  {pendingWOs.length} of {WORK_ORDERS.length} not yet shipped
                </div>
              </div>
              <Link
                href={`/app/projects/${PROJECT.slug}/planner`}
                className="text-xs text-fg underline-offset-4 hover:underline"
              >
                Open Planner →
              </Link>
            </div>
            {pendingWOs.length === 0 ? (
              <EmptyState
                title="No pending work orders"
                body="All open work has shipped. Add a new WO from the Planner."
              />
            ) : (
              <ul className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                {pendingWOs.map((wo) => (
                  <li key={wo.id}>
                    <Link
                      href={`/app/projects/${PROJECT.slug}/planner/${wo.id}`}
                      className="grid grid-cols-[80px,1fr,auto,auto] items-center gap-4 px-4 py-3 hover:bg-surface/50 transition-colors"
                    >
                      <span className="font-mono text-[11px] text-subtle">{wo.id}</span>
                      <span className="font-serif text-sm text-fg truncate">{wo.title}</span>
                      <StatusPill kind={wo.status} />
                      <StatusPill kind={wo.proofStatus} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Flagged comments" className="mt-8">
            <div className="flex items-baseline justify-between mb-3">
              <div className="text-[10px] uppercase tracking-widest text-subtle">
                Flagged comments
              </div>
              <span className="text-xs text-muted">{FLAGGED_COMMENTS.length} flagged</span>
            </div>
            {FLAGGED_COMMENTS.length === 0 ? (
              <EmptyState
                title="Nothing flagged"
                body="Reviewer or human comments marked for follow-up will land here."
                variant="inline"
              />
            ) : (
              <ul className="rounded-lg border border-border divide-y divide-border">
                {FLAGGED_COMMENTS.map((c) => (
                  <li key={c.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="font-mono text-[11px] text-subtle">
                        {c.author} · {c.workOrderId}
                      </div>
                      <div className="font-mono text-[10px] text-subtle">
                        {formatDateTime(c.t)}
                      </div>
                    </div>
                    <p className="mt-1.5 text-sm text-fg text-pretty">{c.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Coverage heatmap" className="mt-8">
            <div className="text-[10px] uppercase tracking-widest text-subtle mb-3">
              Coverage heatmap · requirements × obligations
            </div>
            <div className="rounded-lg border border-border p-4 overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr>
                    <th scope="col" className="text-left font-normal text-subtle pr-3 pb-2 align-bottom">
                      requirement \ obligation
                    </th>
                    {OBLIGATIONS.map((ob) => (
                      <th
                        key={ob.id}
                        scope="col"
                        className="font-mono text-[10px] text-subtle pb-2 px-1 text-center align-bottom"
                      >
                        <div className="rotate-[-30deg] origin-bottom-left whitespace-nowrap pl-2">
                          {ob.id}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {REQUIREMENTS.map((req) => (
                    <tr key={req.id}>
                      <th scope="row" className="text-left font-mono text-[10px] text-fg pr-3 py-1 whitespace-nowrap">
                        {req.id}
                      </th>
                      {OBLIGATIONS.map((ob) => {
                        const cell = COVERAGE.find(
                          (c) => c.requirementId === req.id && c.obligationId === ob.id,
                        )
                        const status = cell?.status ?? 'na'
                        return (
                          <td key={ob.id} className="px-1 py-1">
                            <div
                              title={`${req.id} × ${ob.id}: ${status}`}
                              className={`h-5 w-full rounded-sm ${HEATMAP_COLOR[status]} border border-border/60`}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 flex flex-wrap gap-3 text-[10px] font-mono text-subtle">
                <Legend cls="bg-accent/80" label="discharged" />
                <Legend cls="bg-amber-500/70" label="partial" />
                <Legend cls="bg-fg/30" label="stale" />
                <Legend cls="bg-fg/15" label="unproven" />
                <Legend cls="bg-transparent border border-border" label="n/a" />
              </div>
            </div>
          </section>
        </div>
      }
      right={
        <AgentRail
          title="Project agent"
          banner={{
            tone: 'info',
            text: '2 obligations partial · 1 unproven. Re-verify suggested.',
          }}
          pinned={[
            { id: PROJECT.slug, kind: 'work-order', label: PROJECT.name },
            { id: 'OB-005', kind: 'obligation', label: 'Active requires unexpired COI' },
          ]}
        />
      }
    />
  )
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded-sm ${cls}`} />
      {label}
    </span>
  )
}
