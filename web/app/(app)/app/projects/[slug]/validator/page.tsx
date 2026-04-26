import type { Metadata } from 'next'
import { ThreePane } from '@/components/app/three-pane'
import { AgentRail } from '@/components/app/agent-rail'
import { ValidatorWorkbench } from '@/components/app/validator-workbench'
import { validatorSummary } from '@/lib/validator-data'

export const metadata: Metadata = {
  title: 'Validator',
  description:
    'External integration surface — App Key, AI-Assistant ↔ Manual-API toggle, sub-tabs for Integration / Actions / Score Types / Tags, plus an inbox.',
}

export default function ValidatorPage() {
  const summary = validatorSummary()
  return (
    <ThreePane
      id="validator"
      left={
        <div className="flex flex-col py-3">
          <div className="px-4 pb-2 text-[10px] uppercase tracking-widest text-subtle">
            Inbox
          </div>
          <ul className="px-4 space-y-1.5 text-xs">
            <li className="flex items-center justify-between">
              <span className="text-muted">Total</span>
              <span className="font-mono text-fg">{summary.total}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-rose-700 dark:text-rose-400">Flagged</span>
              <span className="font-mono text-fg">{summary.byVerdict.flagged}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-amber-700 dark:text-amber-400">Pending</span>
              <span className="font-mono text-fg">{summary.byVerdict.pending}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-accent">Agreed</span>
              <span className="font-mono text-fg">{summary.byVerdict.agreed}</span>
            </li>
          </ul>
          <p className="mt-6 px-4 text-[11px] text-subtle leading-relaxed">
            Inbox feeds the obligation chain. Flagged events surface as counterexamples on the
            cited obligation.
          </p>
        </div>
      }
      center={<ValidatorWorkbench />}
      right={
        <AgentRail
          title="Validator agent"
          banner={
            summary.byVerdict.flagged > 0
              ? {
                  tone: 'error',
                  text: `${summary.byVerdict.flagged} flagged event${
                    summary.byVerdict.flagged === 1 ? '' : 's'
                  } need triage. Open VE-008 first — PII leak.`,
                }
              : { tone: 'info', text: 'Inbox is clean. Re-run any pending event to refresh scores.' }
          }
          chips={['Triage flagged', 'Re-run pending', 'Open obligation drilldown', 'Explain score']}
        />
      }
    />
  )
}
