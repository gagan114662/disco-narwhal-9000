'use client'

import { useCallback, useState } from 'react'
import type { CodeRange, DiffSeed } from '@/lib/diff-data'
import type { WorkOrder } from '@/lib/app-data'
import { DiffViewer } from './diff-viewer'
import { CounterexampleExplorer } from './counterexample-explorer'
import { DockedAgentRail } from './docked-agent-rail'

type Banner = { tone: 'info' | 'warn' | 'error'; text: string }

type Pinned = {
  id: string
  kind: 'requirement' | 'obligation' | 'work-order' | 'blueprint' | 'file'
  label: string
}

type Props = {
  wo: WorkOrder
  diff: DiffSeed
  banner: Banner
  pinned: Pinned[]
  chips: string[]
}

/**
 * Owns the spec ↔ code ↔ proof selection state so the in-rail counterexample
 * explorer can drive the diff's scroll/highlight, not just the in-pane reviewer.
 */
export function DiffWorkspace({ wo, diff, banner, pinned, chips }: Props) {
  const [activeLine, setActiveLine] = useState<number | null>(null)
  const [highlight, setHighlight] = useState<CodeRange[]>([])
  const [activeClauseId, setActiveClauseId] = useState<string | null>(null)

  const onJump = useCallback((range: CodeRange, clauseId?: string) => {
    setActiveLine(range.start)
    setHighlight([range])
    if (clauseId) setActiveClauseId(clauseId)
  }, [])

  const featured =
    diff.reviewer.kind === 'flagged' ? (
      <CounterexampleExplorer
        counterexample={diff.reviewer.counterexample}
        onJumpToRange={(r) => onJump(r)}
      />
    ) : null

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <DiffViewer
        wo={wo}
        diff={diff}
        activeLine={activeLine}
        highlight={highlight}
        activeClauseId={activeClauseId}
        onJump={onJump}
      />
      <DockedAgentRail
        title={`${wo.id} agent`}
        banner={banner}
        pinned={pinned}
        chips={chips}
        featured={featured}
      />
    </div>
  )
}
