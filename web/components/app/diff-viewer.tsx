'use client'

import Link from 'next/link'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  type CodeRange,
  type DiffSeed,
  type LineStatus,
} from '@/lib/diff-data'
import { CodePane } from './code-pane'
import { SpecPane } from './spec-pane'
import { CounterexamplePane } from './counterexample-pane'
import { MergeGateLauncher } from './merge-gate-launcher'
import { cn } from '@/lib/cn'
import { PROJECT, type WorkOrder } from '@/lib/app-data'

const FILTER_OPTIONS: Array<{ id: 'all' | LineStatus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'flagged', label: 'Flagged' },
  { id: 'partial', label: 'Partial' },
  { id: 'unproven', label: 'Unproven' },
  { id: 'unspec', label: 'Unspec’d' },
  { id: 'discharged', label: 'Discharged' },
]

type Props = {
  wo: WorkOrder
  diff: DiffSeed
  /** Controlled active line. If omitted, DiffViewer manages its own state. */
  activeLine?: number | null
  /** Controlled highlight ranges. */
  highlight?: CodeRange[]
  /** Controlled active spec clause id. */
  activeClauseId?: string | null
  /** Called when the user jumps via spec/reviewer/next-issue. */
  onJump?: (range: CodeRange, clauseId?: string) => void
}

export function DiffViewer({
  wo,
  diff,
  activeLine: activeLineProp,
  highlight: highlightProp,
  activeClauseId: activeClauseIdProp,
  onJump,
}: Props) {
  const [filter, setFilter] = useState<(typeof FILTER_OPTIONS)[number]['id']>('all')
  const [activeLineLocal, setActiveLineLocal] = useState<number | null>(null)
  const [highlightLocal, setHighlightLocal] = useState<CodeRange[]>([])
  const [activeClauseIdLocal, setActiveClauseIdLocal] = useState<string | null>(null)
  const [showSpec, setShowSpec] = useState(true)
  const [scrollLocked, setScrollLocked] = useState(true)
  const [issueCursor, setIssueCursor] = useState(0)

  const activeLine = activeLineProp !== undefined ? activeLineProp : activeLineLocal
  const highlight = highlightProp !== undefined ? highlightProp : highlightLocal
  const activeClauseId =
    activeClauseIdProp !== undefined ? activeClauseIdProp : activeClauseIdLocal

  const builderRef = useRef<HTMLDivElement | null>(null)
  const reviewerRef = useRef<HTMLDivElement | null>(null)
  const programmaticRef = useRef(false)

  const issueLines = useMemo(
    () =>
      diff.builderLines
        .map((l, i) => ({ line: i + 1, status: l.meta.status }))
        .filter(
          (entry) =>
            entry.status === 'flagged' ||
            entry.status === 'partial' ||
            entry.status === 'unproven' ||
            entry.status === 'unspec',
        )
        .map((e) => e.line),
    [diff.builderLines],
  )

  const filterStatuses = useMemo<Set<LineStatus> | null>(() => {
    if (filter === 'all') return null
    return new Set([filter])
  }, [filter])

  const counts = useMemo(() => {
    const init: Record<LineStatus, number> = {
      discharged: 0,
      partial: 0,
      unproven: 0,
      stale: 0,
      flagged: 0,
      unspec: 0,
      na: 0,
    }
    for (const l of diff.builderLines) {
      init[l.meta.status] += 1
    }
    return init
  }, [diff.builderLines])

  const onJumpToRange = useCallback(
    (range: CodeRange, clauseId?: string) => {
      if (onJump) {
        onJump(range, clauseId)
        return
      }
      setActiveLineLocal(range.start)
      setHighlightLocal([range])
      if (clauseId) setActiveClauseIdLocal(clauseId)
    },
    [onJump],
  )

  const jumpToNextIssue = useCallback(() => {
    if (issueLines.length === 0) return
    const next = issueLines[issueCursor % issueLines.length] ?? issueLines[0]
    if (next === undefined) return
    const range: CodeRange = { start: next, end: next }
    if (onJump) {
      onJump(range)
    } else {
      setActiveLineLocal(next)
      setHighlightLocal([range])
    }
    setIssueCursor((i) => i + 1)
  }, [issueLines, issueCursor, onJump])

  const onBuilderScroll = useCallback(
    (top: number) => {
      if (!scrollLocked) return
      if (programmaticRef.current) return
      programmaticRef.current = true
      if (reviewerRef.current) reviewerRef.current.scrollTop = top
      requestAnimationFrame(() => {
        programmaticRef.current = false
      })
    },
    [scrollLocked],
  )

  const onReviewerScroll = useCallback(
    (top: number) => {
      if (!scrollLocked) return
      if (programmaticRef.current) return
      programmaticRef.current = true
      if (builderRef.current) builderRef.current.scrollTop = top
      requestAnimationFrame(() => {
        programmaticRef.current = false
      })
    },
    [scrollLocked],
  )

  return (
    <div className="flex flex-col min-h-0 h-full">
      <header className="flex-shrink-0 border-b border-border px-4 md:px-6 py-3 bg-bg">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <Link
                href={`/app/projects/${PROJECT.slug}/planner/${wo.id}`}
                className="font-mono text-[11px] text-muted hover:text-fg underline-offset-4 hover:underline"
              >
                ← {wo.id}
              </Link>
              <span className="font-serif text-base tracking-tight text-fg truncate">
                {wo.title}
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-subtle">
              spec · code · proof — {diff.builderFile}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <MergeGateLauncher wo={wo} />
            <button
              type="button"
              onClick={jumpToNextIssue}
              disabled={issueLines.length === 0}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] hover:bg-surface transition-colors disabled:opacity-50"
            >
              Next issue ({issueLines.length})
            </button>
            <button
              type="button"
              onClick={() => setScrollLocked((v) => !v)}
              aria-pressed={scrollLocked}
              title="Only meaningful when builder and reviewer are side-by-side."
              className={cn(
                'hidden lg:inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] transition-colors',
                scrollLocked
                  ? 'border-accent/30 bg-accent/5 text-accent'
                  : 'border-border text-muted hover:text-fg hover:bg-surface',
              )}
            >
              {scrollLocked ? 'Scroll: linked' : 'Scroll: free'}
            </button>
            <button
              type="button"
              onClick={() => setShowSpec((v) => !v)}
              className="hidden xl:inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] hover:bg-surface transition-colors"
            >
              {showSpec ? 'Hide spec' : 'Show spec'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {FILTER_OPTIONS.map((opt) => {
            const active = filter === opt.id
            const count = opt.id === 'all' ? diff.builderLines.length : counts[opt.id]
            const isDisabled = opt.id !== 'all' && count === 0
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilter(opt.id)}
                disabled={isDisabled}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                  active
                    ? 'border-fg bg-fg text-bg'
                    : 'border-border text-muted hover:text-fg hover:bg-surface',
                  isDisabled && 'opacity-40 cursor-not-allowed',
                )}
              >
                {opt.label}
                <span
                  className={cn(
                    'font-mono text-[10px]',
                    active ? 'text-bg/70' : 'text-subtle',
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </header>

      <div
        className={cn(
          'flex-1 grid min-h-0',
          'grid-cols-1',
          'lg:grid-cols-[minmax(0,1.5fr),minmax(280px,400px)]',
          showSpec
            ? 'xl:grid-cols-[minmax(280px,360px),minmax(0,1.5fr),minmax(280px,400px)]'
            : 'xl:grid-cols-[minmax(0,1.5fr),minmax(280px,400px)]',
        )}
      >
        {showSpec && (
          <div className="hidden xl:block border-r border-border min-h-0">
            <SpecPane
              clauses={diff.specClauses}
              activeClauseId={activeClauseId}
              onJump={onJumpToRange}
            />
          </div>
        )}

        <CodePane
          ref={builderRef}
          title={diff.builderFile}
          subtitle="builder · claude-opus-4-7"
          lines={diff.builderLines}
          highlight={highlight}
          activeLine={activeLine}
          filterStatuses={filterStatuses}
          onScroll={onBuilderScroll}
          className="lg:border-r border-border min-h-0"
          trailing={
            <div className="flex items-center gap-2 text-[10px] font-mono text-subtle">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-rose-500" />
                {counts.flagged}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-amber-500" />
                {counts.partial}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-yellow-400" />
                {counts.unspec}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-accent" />
                {counts.discharged}
              </span>
            </div>
          }
        />

        <div className="border-t lg:border-t-0 border-border min-h-0">
          <CounterexamplePane
            ref={reviewerRef}
            reviewer={diff.reviewer}
            onJump={(r) => onJumpToRange(r)}
            onScroll={onReviewerScroll}
          />
        </div>
      </div>

      <footer className="flex-shrink-0 border-t border-border px-4 md:px-6 py-2 bg-bg flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] font-mono text-subtle">
        <Legend tone="bg-rose-500" label={`flagged ${counts.flagged}`} />
        <Legend tone="bg-amber-500" label={`partial ${counts.partial}`} />
        <Legend tone="bg-yellow-400" label={`unspec ${counts.unspec}`} />
        <Legend tone="bg-accent" label={`discharged ${counts.discharged}`} />
        <Legend tone="bg-fg/30" label={`stale ${counts.stale}`} />
        <Legend tone="bg-fg/15" label={`unproven ${counts.unproven}`} />
        <span className="ml-auto">
          {diff.builderLines.length} lines · {issueLines.length} issues · seeded data
        </span>
      </footer>
    </div>
  )
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-2 w-2 rounded-sm', tone)} />
      {label}
    </span>
  )
}
