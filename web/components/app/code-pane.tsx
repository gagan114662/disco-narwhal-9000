'use client'

import { forwardRef, useEffect, useRef } from 'react'
import type { CodeLine, CodeRange, LineStatus } from '@/lib/diff-data'
import { cn } from '@/lib/cn'

const GUTTER_TONE: Record<LineStatus, string> = {
  discharged: 'bg-accent',
  partial: 'bg-amber-500',
  unproven: 'bg-fg/15',
  stale: 'bg-fg/30',
  flagged: 'bg-rose-500',
  unspec: 'bg-yellow-400',
  na: 'bg-transparent',
}

const ROW_TINT: Record<LineStatus, string> = {
  discharged: '',
  partial: 'bg-amber-500/[0.04]',
  unproven: '',
  stale: '',
  flagged: 'bg-rose-500/[0.06]',
  unspec: 'bg-yellow-400/[0.05]',
  na: '',
}

type Props = {
  title: string
  subtitle?: string
  trailing?: React.ReactNode
  lines: CodeLine[]
  /** Highlighted line ranges (1-based). */
  highlight?: CodeRange[]
  /** Filter — if set, lines whose status is not in this set are dimmed. */
  filterStatuses?: Set<LineStatus> | null
  /** Active line, scrolled into view + ringed. */
  activeLine?: number | null
  /** Called when this pane scrolls (so the parent can sync siblings). */
  onScroll?: (scrollTop: number) => void
  className?: string
}

export const CodePane = forwardRef<HTMLDivElement, Props>(function CodePane(
  {
    title,
    subtitle,
    trailing,
    lines,
    highlight,
    filterStatuses,
    activeLine,
    onScroll,
    className,
  },
  scrollRef,
) {
  const internalRef = useRef<HTMLDivElement | null>(null)
  // Bridge the forwarded ref so the parent can imperatively scroll.
  function setRef(node: HTMLDivElement | null) {
    internalRef.current = node
    if (typeof scrollRef === 'function') scrollRef(node)
    else if (scrollRef) scrollRef.current = node
  }

  useEffect(() => {
    if (!activeLine || !internalRef.current) return
    const row = internalRef.current.querySelector<HTMLDivElement>(
      `[data-line="${activeLine}"]`,
    )
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeLine])

  function isHighlighted(lineNo: number): boolean {
    if (!highlight || highlight.length === 0) return false
    return highlight.some((r) => lineNo >= r.start && lineNo <= r.end)
  }

  return (
    <div className={cn('flex flex-col min-h-0 min-w-0', className)}>
      <header className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-border px-3 py-2 bg-surface/40">
        <div className="min-w-0">
          <div className="font-mono text-[12px] text-fg truncate">{title}</div>
          {subtitle && (
            <div className="font-mono text-[10px] text-subtle truncate">{subtitle}</div>
          )}
        </div>
        {trailing && <div className="flex-shrink-0">{trailing}</div>}
      </header>
      <div
        ref={setRef}
        onScroll={(e) => onScroll?.(e.currentTarget.scrollTop)}
        className="flex-1 overflow-auto bg-bg font-mono text-[12px] leading-[1.55]"
      >
        <table className="border-collapse">
          <tbody>
            {lines.map((l, i) => {
              const lineNo = i + 1
              const dimmed =
                filterStatuses !== null &&
                filterStatuses !== undefined &&
                filterStatuses.size > 0 &&
                !filterStatuses.has(l.meta.status)
              const isActive = activeLine === lineNo
              const isHL = isHighlighted(lineNo)
              const tint = ROW_TINT[l.meta.status] || ''
              return (
                <tr
                  key={i}
                  data-line={lineNo}
                  className={cn(
                    'group',
                    tint,
                    isHL && !tint && 'bg-accent/[0.06]',
                    isActive && 'ring-1 ring-accent ring-inset',
                    dimmed && 'opacity-30',
                  )}
                  title={l.meta.reason}
                >
                  <td
                    className={cn(
                      'w-1 sticky left-0 align-top',
                      GUTTER_TONE[l.meta.status],
                    )}
                    aria-hidden
                  />
                  <td className="w-[44px] pr-2 pl-3 text-right align-top text-subtle select-none sticky left-1 bg-bg/95">
                    {lineNo}
                  </td>
                  <td className="w-[40px] pr-2 align-top text-[10px] text-subtle select-none whitespace-nowrap">
                    {l.meta.clauseId ?? l.meta.obligationId ?? ''}
                  </td>
                  <td className="pr-4 align-top whitespace-pre text-fg">
                    {l.text || ' '}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {lines.length === 0 && (
          <div className="px-4 py-6 text-xs text-subtle">No source.</div>
        )}
      </div>
    </div>
  )
})
