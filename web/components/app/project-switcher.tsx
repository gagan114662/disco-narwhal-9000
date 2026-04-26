'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { Project } from '@/lib/app-data'
import { cn } from '@/lib/cn'

type Props = {
  current: Project
  projects: Project[]
}

export function ProjectSwitcher({ current, projects }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs hover:bg-surface transition-colors"
      >
        <span className="font-mono text-subtle">project</span>
        <span className="font-serif text-sm text-fg truncate max-w-[180px]">{current.name}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+6px)] z-30 w-72 rounded-lg border border-border bg-bg shadow-lg overflow-hidden"
        >
          <ul className="py-1 max-h-72 overflow-auto">
            {projects.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/app/projects/${p.slug}/overview`}
                  className={cn(
                    'flex items-start gap-3 px-3 py-2.5 text-sm hover:bg-surface transition-colors',
                    p.slug === current.slug && 'bg-surface/50',
                  )}
                >
                  <span className="font-mono text-[10px] text-subtle pt-1 w-3">·</span>
                  <span className="min-w-0">
                    <span className="block font-serif text-sm text-fg truncate">{p.name}</span>
                    <span className="block text-xs text-muted truncate">{p.description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-t border-border p-2">
            <button
              type="button"
              disabled
              className="w-full text-left px-2 py-2 text-sm text-muted rounded-md hover:bg-surface transition-colors disabled:opacity-50"
            >
              + New project (M3)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
