'use client'

import type { CodeRange, SpecClause } from '@/lib/diff-data'

type Props = {
  clauses: SpecClause[]
  /** Optional: which clause id is currently highlighted (matches the active builder line). */
  activeClauseId?: string | null
  onJump: (range: CodeRange, clauseId: string) => void
}

export function SpecPane({ clauses, activeClauseId, onJump }: Props) {
  return (
    <div className="flex flex-col min-h-0">
      <header className="flex-shrink-0 border-b border-border px-3 py-2 bg-surface/40">
        <div className="font-mono text-[12px] text-fg">spec.md</div>
        <div className="font-mono text-[10px] text-subtle">
          {clauses.length} clause{clauses.length === 1 ? '' : 's'}
        </div>
      </header>
      <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
        {clauses.map((c) => {
          const active = c.id === activeClauseId
          return (
            <article
              key={c.id}
              className={`rounded-md border p-3 transition-colors ${
                active ? 'border-accent bg-accent/5' : 'border-border bg-bg'
              }`}
            >
              <header className="flex items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] text-accent">{c.id}</span>
                  <span className="font-serif text-sm tracking-tight text-fg">{c.title}</span>
                </div>
                {c.obligationIds.length > 0 && (
                  <div className="flex gap-1 flex-wrap justify-end">
                    {c.obligationIds.map((id) => (
                      <span
                        key={id}
                        className="rounded-full border border-border px-1.5 py-0.5 text-[9px] font-mono text-muted"
                      >
                        {id}
                      </span>
                    ))}
                  </div>
                )}
              </header>
              <p className="mt-2 text-[12px] text-fg/90 text-pretty leading-relaxed">{c.body}</p>
              {c.relatedRanges && c.relatedRanges.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {c.relatedRanges.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onJump(r, c.id)}
                      className="inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-mono text-muted hover:text-fg hover:bg-bg transition-colors"
                    >
                      <span>L{r.start}</span>
                      <span className="text-subtle">–</span>
                      <span>L{r.end}</span>
                      <span className="text-subtle ml-1">→</span>
                    </button>
                  ))}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
