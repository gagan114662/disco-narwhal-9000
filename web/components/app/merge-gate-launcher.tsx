'use client'

import { useMemo, useState } from 'react'
import { computeMergeGate, type GateVerdict } from '@/lib/merge-gate'
import { MergeGatePreview } from './merge-gate-preview'
import type { WorkOrder } from '@/lib/app-data'
import { cn } from '@/lib/cn'

const TONE: Record<GateVerdict, string> = {
  pass: 'border-accent/30 bg-accent/5 text-accent',
  warn: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
  block: 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400',
}

const LABEL: Record<GateVerdict, string> = {
  pass: 'Merge ready',
  warn: 'Merge with override',
  block: 'Merge blocked',
}

type Props = {
  wo: WorkOrder
  /** Compact pill (used in headers) vs. full button. */
  variant?: 'pill' | 'button'
}

export function MergeGateLauncher({ wo, variant = 'pill' }: Props) {
  const [open, setOpen] = useState(false)
  const gate = useMemo(() => computeMergeGate(wo), [wo])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border transition-colors',
          variant === 'pill' ? 'px-2.5 py-0.5 text-[11px]' : 'px-3 py-1.5 text-xs hover:bg-surface',
          TONE[gate.verdict],
        )}
        title={gate.summary}
      >
        <span aria-hidden className="font-mono text-[10px]">
          {gate.verdict === 'pass' ? '✓' : gate.verdict === 'warn' ? '!' : '✕'}
        </span>
        <span>{LABEL[gate.verdict]}</span>
        <span className="font-mono text-[10px] opacity-70">
          {gate.counts.block}/{gate.counts.warn}/{gate.counts.pass}
        </span>
      </button>
      <MergeGatePreview open={open} onClose={() => setOpen(false)} gate={gate} />
    </>
  )
}
