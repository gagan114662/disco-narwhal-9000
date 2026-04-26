'use client'

import Link from 'next/link'
import { forwardRef } from 'react'
import type { CodeRange, ReviewerPaneContent } from '@/lib/diff-data'
import { PROJECT } from '@/lib/app-data'

type Props = {
  reviewer: ReviewerPaneContent
  onJump: (range: CodeRange) => void
  onScroll?: (top: number) => void
}

export const CounterexamplePane = forwardRef<HTMLDivElement, Props>(
  function CounterexamplePane({ reviewer, onJump, onScroll }, ref) {
    return (
      <div className="flex flex-col min-h-0 h-full">
        <header className="flex-shrink-0 border-b border-border px-3 py-2 bg-surface/40">
          <div className="font-mono text-[12px] text-fg">reviewer/verdict.json</div>
          <div className="font-mono text-[10px]">
            {reviewer.kind === 'agreed' && (
              <span className="text-accent">
                agreed · {reviewer.verdicts.length} verdicts
              </span>
            )}
            {reviewer.kind === 'flagged' && (
              <span className="text-rose-700 dark:text-rose-400">
                flagged · {reviewer.counterexample.steps.length} steps
              </span>
            )}
            {reviewer.kind === 'pending' && <span className="text-subtle">pending</span>}
          </div>
        </header>
        <div
          ref={ref}
          onScroll={(e) => onScroll?.(e.currentTarget.scrollTop)}
          className="flex-1 overflow-auto px-4 py-4"
        >
          {reviewer.kind === 'pending' && (
            <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted">
              Reviewer has not produced a verdict yet. {reviewer.reason}
            </div>
          )}

          {reviewer.kind === 'agreed' && (
            <ul className="space-y-3">
              {reviewer.verdicts.map((v) => (
                <li
                  key={v.clauseId}
                  className="rounded-md border border-accent/30 bg-accent/5 p-3"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[11px] text-accent">{v.clauseId}</span>
                    <span className="text-[10px] uppercase tracking-widest text-accent">
                      satisfied
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12px] text-fg leading-relaxed">{v.note}</p>
                </li>
              ))}
            </ul>
          )}

          {reviewer.kind === 'flagged' && (
            <div className="space-y-5">
              <section className="rounded-md border border-rose-500/30 bg-rose-500/[0.06] p-3">
                <div className="text-[10px] uppercase tracking-widest text-rose-700 dark:text-rose-400">
                  Counterexample
                </div>
                <p className="mt-1.5 text-[12px] text-fg text-pretty leading-relaxed">
                  {reviewer.counterexample.summary}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {reviewer.counterexample.obligationIds.map((id) => (
                    <Link
                      key={id}
                      href={`/app/projects/${PROJECT.slug}/proofs/${id}`}
                      className="rounded-full border border-border bg-bg px-2 py-0.5 text-[10px] font-mono text-muted hover:text-fg hover:bg-surface transition-colors"
                    >
                      {id}
                    </Link>
                  ))}
                </div>
              </section>

              <section>
                <div className="text-[10px] uppercase tracking-widest text-subtle">Trace</div>
                <ol className="mt-2 space-y-2">
                  {reviewer.counterexample.steps.map((step, i) => (
                    <li key={step.id}>
                      <button
                        type="button"
                        onClick={() => step.range && onJump(step.range)}
                        disabled={!step.range}
                        className="w-full text-left flex gap-3 rounded-md border border-border bg-bg p-3 hover:bg-surface/40 transition-colors disabled:cursor-default disabled:hover:bg-bg"
                      >
                        <span className="flex-shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-[10px] font-mono text-fg">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] text-fg leading-snug">
                            {step.label}
                          </span>
                          {step.detail && (
                            <span className="mt-1 block text-[11px] text-muted leading-snug">
                              {step.detail}
                            </span>
                          )}
                          {step.range && (
                            <span className="mt-1.5 inline-block font-mono text-[10px] text-accent">
                              jump to L{step.range.start}–L{step.range.end} →
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </section>

              <section>
                <div className="text-[10px] uppercase tracking-widest text-subtle">
                  Affected files
                </div>
                <ul className="mt-2 space-y-1 font-mono text-[11px] text-muted">
                  {reviewer.counterexample.affectedFiles.map((f) => (
                    <li key={f}>· {f}</li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </div>
      </div>
    )
  },
)
