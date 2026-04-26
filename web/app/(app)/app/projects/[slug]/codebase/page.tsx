import type { Metadata } from 'next'
import { ThreePane } from '@/components/app/three-pane'
import { AgentRail } from '@/components/app/agent-rail'
import { CodebaseTree } from '@/components/app/codebase-tree'
import { INDEXING } from '@/lib/app-data'
import { FILES, annotationCounts } from '@/lib/codebase-data'
import { formatDateTime } from '@/lib/format-time'

export const metadata: Metadata = {
  title: 'Codebase',
  description:
    'File tree + symbol list with annotation badges (Spec / Proof / Tests / Bare / Stale).',
}

export default function CodebasePage() {
  const counts = annotationCounts(FILES)
  return (
    <ThreePane
      id="codebase"
      left={
        <div className="flex flex-col py-3">
          <div className="px-4 pb-2 text-[10px] uppercase tracking-widest text-subtle">
            Index
          </div>
          <ul className="px-4 space-y-1.5 text-xs">
            <li className="flex items-center justify-between gap-2">
              <span className="text-muted truncate">{INDEXING.repo}</span>
              <span className="font-mono text-subtle">@{INDEXING.branch}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted">Files</span>
              <span className="font-mono text-fg">{INDEXING.files}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted">Symbols</span>
              <span className="font-mono text-fg">{INDEXING.symbols}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted">Status</span>
              <span className="font-mono text-fg">{INDEXING.status}</span>
            </li>
          </ul>
          <div className="mt-2 px-4 font-mono text-[10px] text-subtle">
            indexed {formatDateTime(INDEXING.lastIndexedAt)}
          </div>

          <div className="mt-6 px-4 pb-2 text-[10px] uppercase tracking-widest text-subtle">
            Annotation totals
          </div>
          <ul className="px-4 space-y-1 text-xs text-muted">
            <li className="flex items-center justify-between"><span>Spec</span><span className="font-mono">{counts.spec}</span></li>
            <li className="flex items-center justify-between"><span>Proof</span><span className="font-mono">{counts.proof}</span></li>
            <li className="flex items-center justify-between"><span>Tests</span><span className="font-mono">{counts.tests}</span></li>
            <li className="flex items-center justify-between"><span>Bare</span><span className="font-mono">{counts.bare}</span></li>
            <li className="flex items-center justify-between"><span>Stale</span><span className="font-mono">{counts.stale}</span></li>
          </ul>

          <p className="mt-6 px-4 text-[11px] text-subtle leading-relaxed">
            Symbol-level drilldown and the “unspec’d public API” linter explanation land next
            batch.
          </p>
        </div>
      }
      center={<CodebaseTree />}
      right={
        <AgentRail
          title="Codebase agent"
          banner={{
            tone: 'info',
            text: 'lib/compliance.ts is empty but cited by OB-005. Want a stub?',
          }}
          chips={[
            'Open OB-005 obligation',
            'Generate compliance stub',
            'Find unspec’d public APIs',
            'Re-index repo',
          ]}
        />
      }
    />
  )
}
