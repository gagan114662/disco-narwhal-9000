import type { ReactNode } from 'react'
import { ThreePane } from './three-pane'
import { AgentRail } from './agent-rail'
import { EmptyState } from '@/components/ui/empty-state'

type Props = {
  paneId: string
  module: string
  title: string
  description: string
  leftTreeTitle?: string
  leftTreeItems?: Array<{ id: string; label: string; hint?: string }>
  centerNote?: string
  centerBody?: ReactNode
  agentTitle?: string
  agentBanner?: { tone: 'info' | 'warn' | 'error'; text: string } | null
  agentPinned?: Array<{
    id: string
    kind: 'requirement' | 'obligation' | 'work-order' | 'blueprint' | 'file'
    label: string
  }>
}

export function ModuleStub({
  paneId,
  module,
  title,
  description,
  leftTreeTitle,
  leftTreeItems = [],
  centerNote,
  centerBody,
  agentTitle,
  agentBanner = null,
  agentPinned = [],
}: Props) {
  return (
    <ThreePane
      id={paneId}
      left={
        leftTreeTitle ? (
          <div className="flex flex-col py-3">
            <div className="px-4 pb-2 text-[10px] uppercase tracking-widest text-subtle">
              {leftTreeTitle}
            </div>
            <ul className="flex-1">
              {leftTreeItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-baseline gap-3 px-4 py-2 text-sm text-muted hover:bg-surface/40 cursor-default"
                >
                  <span className="font-mono text-[10px] text-subtle w-12 flex-shrink-0">
                    {item.id}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-fg truncate">{item.label}</span>
                    {item.hint && (
                      <span className="block text-[11px] text-muted truncate">{item.hint}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null
      }
      center={
        <div className="px-5 md:px-8 py-6 md:py-8 max-w-5xl">
          <header className="mb-6">
            <div className="text-[10px] uppercase tracking-widest text-subtle">{module}</div>
            <h1 className="font-serif text-2xl tracking-tight mt-1.5 text-balance">{title}</h1>
            <p className="mt-2 text-sm text-muted text-pretty max-w-prose">{description}</p>
          </header>
          {centerBody ?? (
            <EmptyState
              title={centerNote ?? 'Module shell shipped. Deeper view lands next batch.'}
              body="The shape and the data are wired. Editor / detail / live runs come in the next pass."
            />
          )}
        </div>
      }
      right={
        <AgentRail title={agentTitle ?? 'Agent'} banner={agentBanner} pinned={agentPinned} />
      }
    />
  )
}
