'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { PROJECT } from '@/lib/app-data'
import {
  VALIDATOR_INBOX,
  VALIDATOR_KEY,
  VALIDATOR_SCORE_TYPES,
  VALIDATOR_TAGS,
  VALIDATOR_ACTIONS,
  type ValidatorEvent,
  type ValidatorVerdict,
} from '@/lib/validator-data'
import { formatDateTime } from '@/lib/format-time'
import { cn } from '@/lib/cn'

type Tab = 'inbox' | 'integration' | 'actions' | 'scores' | 'tags'

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: 'inbox', label: 'Inbox', hint: 'arriving validations' },
  { id: 'integration', label: 'Integration', hint: 'app key + connector mode' },
  { id: 'actions', label: 'Actions', hint: 'rules that fire on verdict' },
  { id: 'scores', label: 'Score types', hint: 'what the validator measures' },
  { id: 'tags', label: 'Tags', hint: 'free-form classification' },
]

const VERDICT_TONE: Record<ValidatorVerdict, string> = {
  flagged: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30',
  agreed: 'bg-accent/10 text-accent border-accent/30',
  pending: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
}

export function ValidatorWorkbench() {
  const [tab, setTab] = useState<Tab>('inbox')
  const [activeId, setActiveId] = useState<string>(VALIDATOR_INBOX[0]?.id ?? '')
  const [verdictFilter, setVerdictFilter] = useState<ValidatorVerdict | 'all'>('all')

  const filtered = useMemo(
    () =>
      verdictFilter === 'all'
        ? VALIDATOR_INBOX
        : VALIDATOR_INBOX.filter((e) => e.verdict === verdictFilter),
    [verdictFilter],
  )

  const active = useMemo(
    () => filtered.find((e) => e.id === activeId) ?? filtered[0] ?? null,
    [filtered, activeId],
  )

  return (
    <div className="flex flex-col min-h-0 h-full">
      <header className="flex-shrink-0 border-b border-border px-5 md:px-8 py-4 bg-bg">
        <div className="text-[10px] uppercase tracking-widest text-subtle">Validator</div>
        <h1 className="mt-1 font-serif text-2xl tracking-tight">External validation surface</h1>
        <p className="mt-1.5 text-sm text-muted max-w-prose">
          Where signals come in from outside the platform. Each event is scored against the
          spec and routed back to obligations.
        </p>
        <nav role="tablist" className="mt-4 flex flex-wrap gap-1.5">
          {TABS.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                  active
                    ? 'border-fg bg-fg text-bg'
                    : 'border-border text-muted hover:text-fg hover:bg-surface',
                )}
              >
                {t.label}
                <span
                  className={cn(
                    'font-mono text-[10px]',
                    active ? 'text-bg/70' : 'text-subtle',
                  )}
                >
                  {countFor(t.id)}
                </span>
              </button>
            )
          })}
        </nav>
      </header>

      {tab === 'inbox' && (
        <InboxView
          filtered={filtered}
          verdictFilter={verdictFilter}
          setVerdictFilter={setVerdictFilter}
          active={active}
          setActiveId={setActiveId}
        />
      )}
      {tab === 'integration' && <IntegrationView />}
      {tab === 'actions' && <ActionsView />}
      {tab === 'scores' && <ScoresView />}
      {tab === 'tags' && <TagsView />}
    </div>
  )
}

function countFor(id: Tab): number {
  switch (id) {
    case 'inbox':
      return VALIDATOR_INBOX.length
    case 'integration':
      return 1
    case 'actions':
      return VALIDATOR_ACTIONS.length
    case 'scores':
      return VALIDATOR_SCORE_TYPES.length
    case 'tags':
      return VALIDATOR_TAGS.length
  }
}

function InboxView({
  filtered,
  verdictFilter,
  setVerdictFilter,
  active,
  setActiveId,
}: {
  filtered: ValidatorEvent[]
  verdictFilter: ValidatorVerdict | 'all'
  setVerdictFilter: (v: ValidatorVerdict | 'all') => void
  active: ValidatorEvent | null
  setActiveId: (id: string) => void
}) {
  return (
    <div className="flex-1 grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(280px,360px),minmax(0,1fr)]">
      <aside className="border-b lg:border-b-0 lg:border-r border-border min-h-0 flex flex-col">
        <div className="flex-shrink-0 px-3 py-2 border-b border-border bg-surface/30 flex items-center gap-1.5">
          {(['all', 'flagged', 'pending', 'agreed'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setVerdictFilter(f)}
              aria-pressed={verdictFilter === f}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors',
                verdictFilter === f
                  ? 'border-fg bg-fg text-bg'
                  : 'border-border text-muted hover:text-fg hover:bg-surface',
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <ul className="flex-1 overflow-auto divide-y divide-border">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-xs text-subtle">No events match this filter.</li>
          ) : (
            filtered.map((e) => {
              const isActive = active?.id === e.id
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(e.id)}
                    className={cn(
                      'w-full text-left px-3 py-2.5 transition-colors border-l-2',
                      isActive
                        ? 'border-accent bg-surface'
                        : 'border-transparent hover:bg-surface/40',
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[10px] text-subtle">{e.id}</span>
                      <VerdictPill verdict={e.verdict} />
                    </div>
                    <div className="mt-1 text-[12px] text-fg leading-snug line-clamp-2">
                      {e.prompt}
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-subtle">
                      <span>{e.source}</span>
                      <span>·</span>
                      <span>{formatDateTime(e.receivedAt)}</span>
                    </div>
                  </button>
                </li>
              )
            })
          )}
        </ul>
      </aside>
      <section className="min-h-0 overflow-auto">
        {active ? <EventDetail event={active} /> : <EmptyDetail />}
      </section>
    </div>
  )
}

function EmptyDetail() {
  return (
    <div className="px-6 py-12 text-sm text-muted">
      Select an event to see its prompt, response, scores, and obligation citations.
    </div>
  )
}

function EventDetail({ event }: { event: ValidatorEvent }) {
  return (
    <article className="px-5 md:px-8 py-6 max-w-3xl">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] text-subtle">{event.id}</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
              {event.source}
            </span>
          </div>
          <h2 className="mt-1 font-serif text-lg tracking-tight text-fg text-balance">
            {event.prompt}
          </h2>
          <div className="mt-2 font-mono text-[10px] text-subtle">
            {formatDateTime(event.receivedAt)}
          </div>
        </div>
        <VerdictPill verdict={event.verdict} />
      </header>

      <section className="mt-5">
        <div className="text-[10px] uppercase tracking-widest text-subtle">Response</div>
        <p className="mt-1.5 rounded-md border border-border bg-surface/30 p-3 text-sm text-fg whitespace-pre-line">
          {event.response}
        </p>
      </section>

      {event.reviewerNote && (
        <section className="mt-5">
          <div className="text-[10px] uppercase tracking-widest text-amber-700 dark:text-amber-400">
            Reviewer note
          </div>
          <p className="mt-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-fg">
            {event.reviewerNote}
          </p>
        </section>
      )}

      <section className="mt-5">
        <div className="text-[10px] uppercase tracking-widest text-subtle">Scores</div>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {event.scores.map((s) => (
            <li
              key={s.id}
              className="rounded-md border border-border bg-bg px-3 py-2.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm text-fg">{s.label}</div>
                <div
                  className={cn(
                    'font-mono text-[12px]',
                    s.value < 0.5
                      ? 'text-rose-700 dark:text-rose-400'
                      : s.value < 0.75
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-accent',
                  )}
                >
                  {s.value.toFixed(2)}
                </div>
              </div>
              <ScoreBar value={s.value} />
              {s.rationale && (
                <p className="mt-1.5 text-[11px] text-muted leading-snug">{s.rationale}</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-5 grid sm:grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-subtle">Obligations</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {event.obligationIds.length === 0 ? (
              <span className="text-[11px] font-mono text-subtle">—</span>
            ) : (
              event.obligationIds.map((id) => (
                <Link
                  key={id}
                  href={`/app/projects/${PROJECT.slug}/proofs/${id}`}
                  className="rounded-full border border-border px-2 py-0.5 text-[10px] font-mono text-muted hover:text-fg hover:bg-surface transition-colors"
                >
                  {id}
                </Link>
              ))
            )}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-subtle">Tags</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {event.tags.length === 0 ? (
              <span className="text-[11px] font-mono text-subtle">—</span>
            ) : (
              event.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-border px-2 py-0.5 text-[10px] font-mono text-muted"
                >
                  {t}
                </span>
              ))
            )}
          </div>
        </div>
      </section>
    </article>
  )
}

function ScoreBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone =
    value < 0.5 ? 'bg-rose-500' : value < 0.75 ? 'bg-amber-500' : 'bg-accent'
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border/60">
      <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
    </div>
  )
}

function VerdictPill({ verdict }: { verdict: ValidatorVerdict }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest font-mono',
        VERDICT_TONE[verdict],
      )}
    >
      {verdict}
    </span>
  )
}

function IntegrationView() {
  return (
    <section className="px-5 md:px-8 py-6 max-w-3xl">
      <h2 className="font-serif text-lg tracking-tight">App Key</h2>
      <p className="mt-1 text-sm text-muted max-w-prose">
        One key per project. Send prompts and responses to the validator endpoint to score
        them against this project’s obligations.
      </p>
      <div className="mt-4 rounded-md border border-border bg-bg p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[11px] text-subtle">{VALIDATOR_KEY.id}</div>
            <div className="mt-1 font-mono text-sm text-fg">{VALIDATOR_KEY.lastFour}</div>
          </div>
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] hover:bg-surface transition-colors disabled:opacity-50"
          >
            Rotate (M3)
          </button>
        </div>
        <div className="mt-2 font-mono text-[10px] text-subtle">
          created {formatDateTime(VALIDATOR_KEY.createdAt)}
        </div>
      </div>

      <h3 className="mt-8 font-serif text-base tracking-tight">Connector mode</h3>
      <div className="mt-2 grid sm:grid-cols-2 gap-3">
        <ModePill title="AI-Assistant" body="Streaming integration via SDK. Auto-tags by call site." />
        <ModePill title="Manual API" body="Explicit POST per validation. Caller supplies tags." />
      </div>

      <h3 className="mt-8 font-serif text-base tracking-tight">Try it</h3>
      <label className="mt-2 block">
        <span className="text-[10px] uppercase tracking-widest text-subtle">Paste a prompt</span>
        <textarea
          rows={4}
          placeholder="Approve vendor v_311 as manager_id=u_99."
          className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
        />
      </label>
      <button
        type="button"
        disabled
        className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-surface transition-colors disabled:opacity-50"
      >
        Submit (M3 — wires to live endpoint)
      </button>
    </section>
  )
}

function ModePill({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2.5">
      <div className="text-sm text-fg">{title}</div>
      <p className="mt-1 text-[12px] text-muted leading-snug">{body}</p>
    </div>
  )
}

function ActionsView() {
  return (
    <section className="px-5 md:px-8 py-6 max-w-3xl">
      <h2 className="font-serif text-lg tracking-tight">Routing actions</h2>
      <p className="mt-1 text-sm text-muted max-w-prose">
        Rules that fire when a verdict lands. Today these are display-only — the executor wires
        next batch.
      </p>
      <ul className="mt-4 divide-y divide-border border border-border rounded-md overflow-hidden">
        {VALIDATOR_ACTIONS.map((a) => (
          <li key={a.id} className="px-3 py-2.5 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-fg">{a.label}</div>
              <div className="font-mono text-[10px] text-subtle">{a.hint}</div>
            </div>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-widest text-subtle">
              draft
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ScoresView() {
  return (
    <section className="px-5 md:px-8 py-6 max-w-3xl">
      <h2 className="font-serif text-lg tracking-tight">Score types</h2>
      <ul className="mt-4 divide-y divide-border border border-border rounded-md overflow-hidden">
        {VALIDATOR_SCORE_TYPES.map((s) => (
          <li key={s.id} className="px-3 py-2.5">
            <div className="text-sm text-fg">{s.label}</div>
            <div className="text-[12px] text-muted">{s.description}</div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function TagsView() {
  return (
    <section className="px-5 md:px-8 py-6 max-w-3xl">
      <h2 className="font-serif text-lg tracking-tight">Tags</h2>
      <ul className="mt-4 grid sm:grid-cols-2 gap-2">
        {VALIDATOR_TAGS.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2"
          >
            <span className="font-mono text-[12px] text-fg">{t.label}</span>
            <span className="font-mono text-[10px] text-subtle">{t.count}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
