import Link from 'next/link'
import { type Obligation, PROJECT } from '@/lib/app-data'
import { StatusPill } from '@/components/ui/status-pill'
import { ReVerifyButton } from './re-verify-button'
import { formatDate } from '@/lib/format-time'

const KIND_LABEL: Record<Obligation['kind'], string> = {
  safety: 'Safety',
  security: 'Security',
  compliance: 'Compliance',
  functional: 'Functional',
}

const EVIDENCE_GLYPH: Record<NonNullable<Obligation['evidence']>[number]['kind'], string> = {
  test: '⏵',
  spec: '§',
  run: '◆',
  review: '⚑',
}

type Props = {
  obligation: Obligation
  /** Show the link back to the obligation detail page. Off when this card IS the detail page. */
  showOpenLink?: boolean
  /** Show outgoing links to related work orders. */
  showWorkOrderLinks?: boolean
}

export function ObligationCard({
  obligation,
  showOpenLink = false,
  showWorkOrderLinks = true,
}: Props) {
  const ob = obligation
  const evidence = ob.evidence ?? []

  return (
    <article className="rounded-lg border border-border bg-bg p-5 md:p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] text-subtle">{ob.id}</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
              {KIND_LABEL[ob.kind]}
            </span>
          </div>
          <h3 className="mt-1 font-serif text-lg tracking-tight text-fg text-balance">
            {ob.title}
          </h3>
          <p className="mt-2 text-sm text-muted text-pretty max-w-prose">{ob.description}</p>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <StatusPill kind={ob.status} />
          {showOpenLink && (
            <Link
              href={`/app/projects/${PROJECT.slug}/proofs/${ob.id}`}
              className="text-[11px] text-muted hover:text-fg underline-offset-4 hover:underline transition-colors"
            >
              Open detail →
            </Link>
          )}
        </div>
      </header>

      {ob.rationale && (
        <section className="mt-5">
          <div className="text-[10px] uppercase tracking-widest text-subtle">Rationale</div>
          <p className="mt-1.5 text-sm text-fg/90 text-pretty max-w-prose">{ob.rationale}</p>
        </section>
      )}

      {ob.counterexample && (
        <section className="mt-5">
          <div className="text-[10px] uppercase tracking-widest text-amber-700 dark:text-amber-400">
            Counterexample
          </div>
          <p className="mt-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-fg text-pretty">
            {ob.counterexample}
          </p>
        </section>
      )}

      <section className="mt-5 grid sm:grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-subtle">Tags</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ob.tags.length === 0 ? (
              <span className="text-[11px] font-mono text-subtle">—</span>
            ) : (
              ob.tags.map((t) => (
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
        <div>
          <div className="text-[10px] uppercase tracking-widest text-subtle">Work orders</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ob.workOrderIds.length === 0 ? (
              <span className="text-[11px] font-mono text-subtle">—</span>
            ) : showWorkOrderLinks ? (
              ob.workOrderIds.map((id) => (
                <Link
                  key={id}
                  href={`/app/projects/${PROJECT.slug}/planner/${id}`}
                  className="rounded-full border border-border px-2 py-0.5 text-[10px] font-mono text-muted hover:text-fg hover:bg-surface transition-colors"
                >
                  {id}
                </Link>
              ))
            ) : (
              ob.workOrderIds.map((id) => (
                <span
                  key={id}
                  className="rounded-full border border-border px-2 py-0.5 text-[10px] font-mono text-muted"
                >
                  {id}
                </span>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[10px] uppercase tracking-widest text-subtle">
            Evidence ({evidence.length})
          </div>
          <ReVerifyButton current={ob.status} />
        </div>
        {evidence.length === 0 ? (
          <div className="mt-2 rounded-md border border-dashed border-border p-4 text-xs text-muted">
            No evidence attached. Run a test, attach a spec snapshot, or accept reviewer
            verdicts to build coverage.
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border border border-border rounded-md overflow-hidden">
            {evidence.map((e) => (
              <li
                key={e.id}
                className="grid grid-cols-[24px,1fr,auto,auto] gap-3 items-center px-3 py-2 hover:bg-surface/30"
              >
                <span className="font-mono text-sm text-accent">{EVIDENCE_GLYPH[e.kind]}</span>
                <span className="min-w-0">
                  <span className="block text-sm text-fg truncate">{e.label}</span>
                  <span className="block font-mono text-[10px] text-subtle truncate">
                    {e.ref}
                  </span>
                </span>
                <span className="font-mono text-[10px] text-subtle">
                  {formatDate(e.addedAt)}
                </span>
                <button
                  type="button"
                  className="text-[11px] text-muted hover:text-fg transition-colors"
                  aria-label={`Download ${e.label}`}
                  title="Download evidence"
                >
                  ↓
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  )
}
