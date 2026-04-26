'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { PROJECT } from '@/lib/app-data'
import type { GateCheck, GateVerdict, MergeGate } from '@/lib/merge-gate'
import { cn } from '@/lib/cn'

const VERDICT_TONE: Record<GateVerdict, string> = {
  pass: 'border-accent/40 bg-accent/10 text-accent',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  block: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400',
}

const VERDICT_BANNER: Record<GateVerdict, string> = {
  pass: 'border-accent/40 bg-accent/5 text-accent',
  warn: 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400',
  block: 'border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-400',
}

const VERDICT_GLYPH: Record<GateVerdict, string> = {
  pass: '✓',
  warn: '!',
  block: '✕',
}

type Props = {
  open: boolean
  onClose: () => void
  gate: MergeGate
}

export function MergeGatePreview({ open, onClose, gate }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const orderedChecks = [...gate.checks].sort((a, b) => verdictRank(a.verdict) - verdictRank(b.verdict))

  return (
    <div
      aria-hidden={!open}
      className={cn(
        'fixed inset-0 z-40 transition-opacity duration-200',
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
      )}
    >
      <button
        type="button"
        aria-label="Close merge gate preview"
        onClick={onClose}
        className="absolute inset-0 bg-fg/20 backdrop-blur-[1px]"
      />

      <aside
        role="dialog"
        aria-label="Merge gate preview"
        className={cn(
          'absolute top-0 right-0 h-full w-full sm:w-[440px] xl:w-[500px] border-l border-border bg-bg shadow-2xl flex flex-col',
          'transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex-shrink-0 flex items-center justify-between border-b border-border px-4 py-3 bg-surface/30">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-subtle">Merge gate</div>
            <div className="mt-0.5 text-sm text-fg">
              Preview for <span className="font-mono">{gate.workOrderId}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted hover:text-fg transition-colors flex-shrink-0"
          >
            Close
            <kbd className="ml-2 font-mono text-[10px] rounded border border-border px-1 py-0.5">
              esc
            </kbd>
          </button>
        </header>

        <div className="flex-1 overflow-auto px-4 py-5">
          <section className={cn('rounded-md border p-4', VERDICT_BANNER[gate.verdict])}>
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-[10px] uppercase tracking-widest">
                Verdict · {gate.verdict}
              </div>
              <div className="font-mono text-[11px]">
                {gate.counts.pass} pass · {gate.counts.warn} warn · {gate.counts.block} block
              </div>
            </div>
            <p className="mt-1.5 text-sm leading-snug text-fg">{gate.summary}</p>
          </section>

          <section className="mt-5">
            <div className="text-[10px] uppercase tracking-widest text-subtle">Checks</div>
            <ul className="mt-2 space-y-2">
              {orderedChecks.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
          </section>

          <section className="mt-5">
            <div className="text-[10px] uppercase tracking-widest text-subtle">
              Obligations on this WO
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {gate.obligations.length === 0 ? (
                <span className="text-[11px] font-mono text-subtle">—</span>
              ) : (
                gate.obligations.map((o) => (
                  <Link
                    key={o.id}
                    href={`/app/projects/${PROJECT.slug}/proofs/${o.id}`}
                    className="rounded-full border border-border px-2 py-0.5 text-[10px] font-mono text-muted hover:text-fg hover:bg-surface transition-colors"
                  >
                    {o.id}
                  </Link>
                ))
              )}
            </ul>
          </section>

          <footer className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={gate.verdict === 'block'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors',
                gate.verdict === 'block'
                  ? 'border-border text-subtle cursor-not-allowed opacity-60'
                  : 'border-fg bg-fg text-bg hover:bg-fg/90',
              )}
              title={gate.verdict === 'block' ? 'Blocked by failing checks.' : undefined}
            >
              {gate.verdict === 'block' ? 'Merge refused' : 'Merge (M3)'}
            </button>
            <button
              type="button"
              disabled={gate.verdict === 'pass'}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Re-run checks
            </button>
            {gate.diff && (
              <Link
                href={`/app/projects/${PROJECT.slug}/planner/${gate.workOrderId}/diff`}
                onClick={onClose}
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-fg transition-colors"
              >
                Open diff →
              </Link>
            )}
          </footer>
        </div>
      </aside>
    </div>
  )
}

function CheckRow({ check }: { check: GateCheck }) {
  return (
    <li className={cn('rounded-md border p-3', 'border-border bg-bg')}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[11px] flex-shrink-0',
            VERDICT_TONE[check.verdict],
          )}
        >
          {VERDICT_GLYPH[check.verdict]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm text-fg leading-snug">{check.label}</div>
            {check.ref && (
              <span className="font-mono text-[10px] text-subtle">{check.ref}</span>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-muted leading-snug">{check.detail}</p>
        </div>
      </div>
    </li>
  )
}

function verdictRank(v: GateVerdict): number {
  return v === 'block' ? 0 : v === 'warn' ? 1 : 2
}
