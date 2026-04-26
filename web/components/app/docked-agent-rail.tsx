'use client'

import { useEffect, useState } from 'react'
import { AgentRail } from './agent-rail'
import { cn } from '@/lib/cn'
import type {
  AgentMessage,
} from '@/lib/app-data'

type Pinned = {
  id: string
  kind: 'requirement' | 'obligation' | 'work-order' | 'blueprint' | 'file'
  label: string
}

type Banner = { tone: 'info' | 'warn' | 'error'; text: string } | null

type Props = {
  title?: string
  banner?: Banner
  pinned?: Pinned[]
  chips?: readonly string[]
  initialThread?: AgentMessage[]
  featured?: React.ReactNode
}

export function DockedAgentRail({
  title,
  banner = null,
  pinned = [],
  chips,
  initialThread,
  featured,
}: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open agent rail"
        aria-expanded={open}
        className={cn(
          'fixed right-3 bottom-3 z-30 inline-flex items-center gap-2 rounded-full border border-border bg-bg/95 backdrop-blur-md px-3 py-2 text-xs shadow-lg hover:bg-surface transition-colors',
          open && 'pointer-events-none opacity-0',
        )}
      >
        <span className="inline-flex h-2 w-2 rounded-full bg-accent animate-pulse-soft" />
        <span className="font-mono text-fg">Ask the agent</span>
      </button>

      <div
        aria-hidden={!open}
        className={cn(
          'fixed inset-0 z-40 transition-opacity duration-200',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
      >
        <button
          type="button"
          aria-label="Close agent rail"
          onClick={() => setOpen(false)}
          className="absolute inset-0 bg-fg/20 backdrop-blur-[1px]"
        />

        <aside
          role="dialog"
          aria-label="Agent"
          className={cn(
            'absolute top-0 right-0 h-full w-full sm:w-[380px] xl:w-[420px] border-l border-border bg-bg shadow-2xl flex flex-col',
            'transition-transform duration-200 ease-out',
            open ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          <div className="flex-shrink-0 flex items-center justify-between border-b border-border px-3 py-2 bg-surface/30">
            <span className="text-[10px] uppercase tracking-widest text-subtle">
              {title ?? 'Agent'}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-muted hover:text-fg transition-colors"
            >
              Close
              <kbd className="ml-2 font-mono text-[10px] rounded border border-border px-1 py-0.5">
                esc
              </kbd>
            </button>
          </div>
          <div className="flex-1 min-h-0 flex flex-col">
            <AgentRail
              title={title}
              banner={banner}
              pinned={pinned}
              chips={chips}
              initialThread={initialThread}
              featured={featured}
              hideHeader
            />
          </div>
        </aside>
      </div>
    </>
  )
}
