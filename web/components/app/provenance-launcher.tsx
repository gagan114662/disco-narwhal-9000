'use client'

import { useState } from 'react'
import { ProvenanceDrawer } from './provenance-drawer'
import type { Provenance } from '@/lib/provenance'

type Props = {
  provenance: Provenance | null
  /** Optional override label/style; defaults to a small pill. */
  label?: string
}

/**
 * Server-rendered pages compute the lineage and pass it in; the drawer
 * itself is client-only because it owns open/close state and the esc handler.
 */
export function ProvenanceLauncher({ provenance, label = 'Provenance' }: Props) {
  const [open, setOpen] = useState(false)
  const count = provenance?.nodes.length ?? 0

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted hover:text-fg hover:bg-surface transition-colors"
      >
        {label}
        <span className="font-mono text-[10px] text-subtle">{count}</span>
      </button>
      <ProvenanceDrawer
        open={open}
        onClose={() => setOpen(false)}
        provenance={provenance}
      />
    </>
  )
}
