'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  type Blueprint,
  type Obligation,
  type Requirement,
  type WorkOrder,
  type WorkOrderActivityEvent,
  PROJECT,
} from '@/lib/app-data'
import { StatusPill } from '@/components/ui/status-pill'
import { EmptyState } from '@/components/ui/empty-state'
import { ObligationCard } from './obligation-card'
import { findDiffSeed } from '@/lib/diff-data'
import { cn } from '@/lib/cn'
import { formatDate, formatTimeOfDay } from '@/lib/format-time'

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'blueprint', label: 'Blueprint' },
  { id: 'requirements', label: 'Requirements' },
  { id: 'proof', label: 'Proof' },
] as const

type TabId = (typeof TABS)[number]['id']

type Props = {
  wo: WorkOrder
  blueprint: Blueprint | null
  requirements: Requirement[]
  obligations: Obligation[]
}

export function WorkOrderDetail({ wo, blueprint, requirements, obligations }: Props) {
  const [tab, setTab] = useState<TabId>('details')
  const hasDiff = findDiffSeed(wo.id) !== undefined

  const proofMix = obligations.reduce(
    (acc, ob) => {
      acc[ob.status] = (acc[ob.status] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  return (
    <div className="px-5 md:px-8 py-6 md:py-8 max-w-5xl">
      <div className="mb-3 flex items-center gap-3 text-[11px] font-mono text-subtle">
        <Link
          href={`/app/projects/${PROJECT.slug}/planner`}
          className="hover:text-fg transition-colors"
        >
          ← All work orders
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] text-subtle">{wo.id}</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
              {wo.phase}
            </span>
          </div>
          <h1 className="mt-1.5 font-serif text-2xl tracking-tight text-balance">{wo.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span>
              opened <span className="font-mono text-fg">{formatDate(wo.createdAt)}</span>
            </span>
            <span>
              assignee{' '}
              <span className="font-mono text-fg">
                {wo.assignee ? wo.assignee.name : 'unassigned'}
              </span>
            </span>
            <span>
              files{' '}
              <span className="font-mono text-fg">{wo.files.length}</span>
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <StatusPill kind={wo.status} />
          <StatusPill kind={wo.proofStatus} />
          {hasDiff && (
            <Link
              href={`/app/projects/${PROJECT.slug}/planner/${wo.id}/diff`}
              className="mt-1 inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[11px] hover:bg-surface transition-colors"
            >
              View diff →
            </Link>
          )}
        </div>
      </header>

      <nav aria-label="Tabs" className="border-b border-border flex gap-1">
        {TABS.map((t) => {
          const active = t.id === tab
          const counts =
            t.id === 'requirements'
              ? requirements.length
              : t.id === 'proof'
                ? obligations.length
                : null
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'px-4 py-2 text-sm font-medium tracking-wide border-b-2 -mb-px transition-colors',
                active
                  ? 'border-accent text-fg'
                  : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {t.label}
              {counts !== null && (
                <span className="ml-1.5 font-mono text-[10px] text-subtle">{counts}</span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="pt-6">
        {tab === 'details' && (
          <DetailsTab wo={wo} blueprint={blueprint} requirements={requirements} />
        )}
        {tab === 'blueprint' && <BlueprintTab blueprint={blueprint} />}
        {tab === 'requirements' && <RequirementsTab requirements={requirements} />}
        {tab === 'proof' && <ProofTab obligations={obligations} proofMix={proofMix} />}
      </div>
    </div>
  )
}

function DetailsTab({
  wo,
  blueprint,
  requirements,
}: {
  wo: WorkOrder
  blueprint: Blueprint | null
  requirements: Requirement[]
}) {
  const [showLogs, setShowLogs] = useState(false)
  const visibleActivity = showLogs
    ? wo.activity
    : wo.activity.filter((e) => e.kind !== 'log')

  return (
    <div className="grid lg:grid-cols-[1fr,280px] gap-8">
      <div>
        <section>
          <div className="text-[10px] uppercase tracking-widest text-subtle">
            Implementation files
          </div>
          {wo.files.length === 0 ? (
            <EmptyState
              title="No files yet"
              body="Drafted files appear here once the builder picks up this work order."
              variant="inline"
              className="mt-2"
            />
          ) : (
            <ul className="mt-3 rounded-lg border border-border divide-y divide-border overflow-hidden">
              {wo.files.map((f) => (
                <li
                  key={f.path}
                  className="grid grid-cols-[80px,1fr,auto,auto] items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface/30"
                >
                  <span
                    className={cn(
                      'inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest',
                      f.change === 'create'
                        ? 'border-accent/30 bg-accent/5 text-accent'
                        : 'border-border text-muted',
                    )}
                  >
                    {f.change}
                  </span>
                  <span className="font-mono text-[12px] text-fg truncate">{f.path}</span>
                  <StatusPill kind={f.status === 'committed' ? 'sealed' : f.status === 'drafted' ? 'in_review' : 'pending'} />
                  <button
                    type="button"
                    disabled
                    className="text-[11px] text-muted hover:text-fg transition-colors disabled:opacity-50"
                  >
                    Update with AI
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8">
          <div className="flex items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-widest text-subtle">Activity</div>
            <button
              type="button"
              onClick={() => setShowLogs((v) => !v)}
              className="text-[11px] text-muted hover:text-fg transition-colors"
            >
              {showLogs ? 'Hide logs' : 'Show logs'}
            </button>
          </div>
          {visibleActivity.length === 0 ? (
            <EmptyState title="No activity yet" variant="inline" className="mt-2" />
          ) : (
            <ol className="mt-3 space-y-3">
              {visibleActivity.map((e) => (
                <ActivityRow key={`${e.kind}-${e.t}`} event={e} />
              ))}
            </ol>
          )}
        </section>
      </div>

      <aside className="space-y-5">
        <SidebarBlock label="Blueprint" value={blueprint?.title ?? '—'}>
          {blueprint && (
            <Link
              href={`/app/projects/${PROJECT.slug}/foundry`}
              className="font-mono text-[11px] text-muted hover:text-fg underline-offset-4 hover:underline"
            >
              {blueprint.id} →
            </Link>
          )}
        </SidebarBlock>
        <SidebarBlock label="Requirements">
          {requirements.length === 0 ? (
            <span className="text-[11px] text-subtle">—</span>
          ) : (
            <ul className="space-y-1.5">
              {requirements.map((r) => (
                <li key={r.id} className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] text-subtle">{r.id}</span>
                  <span className="text-[12px] text-fg truncate">{r.title}</span>
                </li>
              ))}
            </ul>
          )}
        </SidebarBlock>
        <SidebarBlock label="Obligations">
          {wo.obligationIds.length === 0 ? (
            <span className="text-[11px] text-subtle">—</span>
          ) : (
            <ul className="space-y-1.5 font-mono text-[10px] text-muted">
              {wo.obligationIds.map((id) => (
                <li key={id}>
                  <Link
                    href={`/app/projects/${PROJECT.slug}/proofs/${id}`}
                    className="hover:text-fg underline-offset-4 hover:underline"
                  >
                    {id}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SidebarBlock>
      </aside>
    </div>
  )
}

function ActivityRow({ event }: { event: WorkOrderActivityEvent }) {
  const time = `${formatDate(event.t)} ${formatTimeOfDay(event.t)}`
  if (event.kind === 'system') {
    return (
      <li className="flex gap-3 text-[12px] font-mono text-subtle">
        <span className="flex-shrink-0">{time}</span>
        <span>system · {event.text}</span>
      </li>
    )
  }
  if (event.kind === 'log') {
    return (
      <li className="flex gap-3 text-[12px] font-mono text-muted">
        <span className="flex-shrink-0 text-subtle">{time}</span>
        <span>log · {event.text}</span>
      </li>
    )
  }
  return (
    <li
      className={cn(
        'rounded-lg border bg-bg p-3',
        event.flagged ? 'border-amber-500/30 bg-amber-500/5' : 'border-border',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-mono text-[11px] text-fg">{event.author}</div>
        <div className="font-mono text-[10px] text-subtle">{time}</div>
      </div>
      <p className="mt-1.5 text-sm text-fg text-pretty">{event.text}</p>
      {event.flagged && (
        <div className="mt-2 text-[10px] uppercase tracking-widest text-amber-700 dark:text-amber-400">
          Flagged for follow-up
        </div>
      )}
    </li>
  )
}

function BlueprintTab({ blueprint }: { blueprint: Blueprint | null }) {
  if (!blueprint) {
    return (
      <EmptyState
        title="No blueprint linked"
        body="Open this WO from a blueprint in Foundry to attach it, or link one from the Details tab."
      />
    )
  }
  return (
    <article className="rounded-lg border border-border bg-bg p-5 md:p-6">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11px] text-subtle">{blueprint.id}</span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
          {blueprint.group}
        </span>
        {blueprint.diagramKind && (
          <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
            · {blueprint.diagramKind}
          </span>
        )}
      </div>
      <h2 className="mt-1.5 font-serif text-xl tracking-tight">{blueprint.title}</h2>
      <section className="mt-5">
        <div className="text-[10px] uppercase tracking-widest text-subtle">Prose</div>
        <p className="mt-1.5 text-sm text-fg text-pretty max-w-prose">{blueprint.prose}</p>
      </section>
      <section className="mt-5">
        <div className="text-[10px] uppercase tracking-widest text-subtle">Formal summary</div>
        <pre className="mt-1.5 rounded-md border border-border bg-surface p-4 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words">
          {blueprint.formalSummary}
        </pre>
      </section>
      <p className="mt-5 text-xs text-subtle">
        Diagram pane and prose ↔ formal toggle land in the next batch.
      </p>
    </article>
  )
}

function RequirementsTab({ requirements }: { requirements: Requirement[] }) {
  if (requirements.length === 0) {
    return (
      <EmptyState
        title="No requirements linked"
        body="Link this WO to one or more requirements from Refinery so reviewers know what to check against."
      />
    )
  }
  return (
    <ul className="space-y-3">
      {requirements.map((r) => (
        <li key={r.id} className="rounded-lg border border-border bg-bg p-5">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] text-subtle">{r.id}</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
              {r.group === 'product_overview' ? 'Product overview' : 'Feature'}
            </span>
          </div>
          <h3 className="mt-1 font-serif text-base tracking-tight">{r.title}</h3>
          <p className="mt-1.5 text-sm text-muted text-pretty max-w-prose">{r.body}</p>
          {r.obligationIds.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {r.obligationIds.map((id) => (
                <Link
                  key={id}
                  href={`/app/projects/${PROJECT.slug}/proofs/${id}`}
                  className="rounded-full border border-border px-2 py-0.5 text-[10px] font-mono text-muted hover:text-fg hover:bg-surface transition-colors"
                >
                  {id}
                </Link>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

function ProofTab({
  obligations,
  proofMix,
}: {
  obligations: Obligation[]
  proofMix: Record<string, number>
}) {
  if (obligations.length === 0) {
    return (
      <EmptyState
        title="No obligations on this work order"
        body="Attach proof obligations from Refinery requirements or the Foundry blueprint."
      />
    )
  }
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border p-4 flex flex-wrap items-center gap-3 text-xs">
        <span className="text-[10px] uppercase tracking-widest text-subtle">Proof mix</span>
        {(['discharged', 'partial', 'unproven', 'stale'] as const).map((s) =>
          proofMix[s] ? (
            <span key={s} className="inline-flex items-center gap-1.5">
              <StatusPill kind={s} />
              <span className="font-mono text-muted">{proofMix[s]}</span>
            </span>
          ) : null,
        )}
      </div>
      {obligations.map((ob) => (
        <ObligationCard key={ob.id} obligation={ob} showOpenLink />
      ))}
    </div>
  )
}

function SidebarBlock({
  label,
  value,
  children,
}: {
  label: string
  value?: string
  children?: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border p-4">
      <div className="text-[10px] uppercase tracking-widest text-subtle">{label}</div>
      {value && <div className="mt-1 text-sm text-fg">{value}</div>}
      {children && <div className="mt-2">{children}</div>}
    </section>
  )
}
