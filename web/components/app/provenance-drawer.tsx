'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { PROJECT } from '@/lib/app-data'
import type { Provenance, ProvenanceNode, ProvenanceStage } from '@/lib/provenance'
import { formatDate } from '@/lib/format-time'
import { cn } from '@/lib/cn'

const STAGE_LABEL: Record<ProvenanceStage, string> = {
  spec: 'Spec',
  planner: 'Planner',
  diff: 'Diff',
  proof: 'Proof',
}

const STAGE_TONE: Record<ProvenanceStage, string> = {
  spec: 'text-fg/80 border-border bg-surface',
  planner: 'text-fg border-border bg-bg',
  diff: 'text-amber-700 dark:text-amber-400 border-amber-500/30 bg-amber-500/5',
  proof: 'text-accent border-accent/30 bg-accent/5',
}

type Props = {
  open: boolean
  onClose: () => void
  provenance: Provenance | null
}

export function ProvenanceDrawer({ open, onClose, provenance }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

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
        aria-label="Close provenance drawer"
        onClick={onClose}
        className="absolute inset-0 bg-fg/20 backdrop-blur-[1px]"
      />

      <aside
        role="dialog"
        aria-label="Provenance"
        className={cn(
          'absolute top-0 right-0 h-full w-full sm:w-[420px] xl:w-[480px] border-l border-border bg-bg shadow-2xl flex flex-col',
          'transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex-shrink-0 flex items-center justify-between border-b border-border px-4 py-3 bg-surface/30">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-subtle">Provenance</div>
            {provenance && (
              <div className="mt-0.5 text-sm text-fg truncate">
                {provenance.obligation.id} · {provenance.obligation.title}
              </div>
            )}
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
          {!provenance || provenance.nodes.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted">
              No lineage yet. The obligation has no requirements, work orders, or evidence
              attached.
            </div>
          ) : (
            <ProvenanceTimeline provenance={provenance} />
          )}
        </div>
      </aside>
    </div>
  )
}

function ProvenanceTimeline({ provenance }: { provenance: Provenance }) {
  const stages: ProvenanceStage[] = ['spec', 'planner', 'diff', 'proof']
  return (
    <ol className="relative">
      <span aria-hidden className="absolute left-3 top-2 bottom-2 w-px bg-border" />
      {stages.map((stage) => {
        const nodes = provenance.nodes.filter((n) => n.stage === stage)
        return (
          <li key={stage} className="mb-6 last:mb-0">
            <div className="flex items-center gap-2 pl-0">
              <span
                className={cn(
                  'relative z-10 inline-flex h-6 min-w-[60px] items-center justify-center rounded-full border px-2 text-[10px] font-mono',
                  STAGE_TONE[stage],
                )}
              >
                {STAGE_LABEL[stage]}
              </span>
              <span className="text-[10px] text-subtle">
                {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'}
              </span>
            </div>
            <ul className="mt-2 ml-9 space-y-2">
              {nodes.length === 0 ? (
                <li className="rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-subtle">
                  No {stage} nodes yet.
                </li>
              ) : (
                nodes.map((n) => <NodeRow key={`${n.stage}-${n.id}`} node={n} />)
              )}
            </ul>
          </li>
        )
      })}
    </ol>
  )
}

function NodeRow({ node }: { node: ProvenanceNode }) {
  const href = hrefFor(node)
  const meta = node.t ? formatDate(node.t) : null
  const inner = (
    <div className="rounded-md border border-border bg-bg px-3 py-2.5 hover:bg-surface/40 transition-colors">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-mono text-[10px] text-subtle">{node.id}</div>
        {meta && <div className="font-mono text-[10px] text-subtle">{meta}</div>}
      </div>
      <div className="mt-0.5 text-sm text-fg leading-snug">{node.title}</div>
      <div className="mt-1 text-[11px] text-muted leading-snug">{node.detail}</div>
    </div>
  )
  if (!href) return <li>{inner}</li>
  return (
    <li>
      <Link href={href} className="block">
        {inner}
      </Link>
    </li>
  )
}

function hrefFor(node: ProvenanceNode): string | null {
  switch (node.kind) {
    case 'work-order':
      return `/app/projects/${PROJECT.slug}/planner/${node.id}`
    case 'diff':
      return `/app/projects/${PROJECT.slug}/planner/${node.workOrderId}/diff`
    case 'requirement':
      return `/app/projects/${PROJECT.slug}/refinery`
    case 'blueprint':
      return `/app/projects/${PROJECT.slug}/foundry`
    case 'evidence':
      return null
  }
}
