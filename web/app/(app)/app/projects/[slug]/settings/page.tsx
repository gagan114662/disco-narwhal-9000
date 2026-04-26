import type { Metadata } from 'next'
import { ModuleStub } from '@/components/app/module-stub'

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Repo + branch rules, merge gate preview, members, danger zone.',
}

export default function SettingsPage() {
  return (
    <ModuleStub
      paneId="settings"
      module="Project · Settings"
      title="Project rules, merge gates, members."
      description="Repo + branch protection rules, merge-gate PR-comment preview, members, danger zone (export / delete). The PR comment preview screen and the merge-gate config form land in the next batch."
      leftTreeTitle="Sections"
      leftTreeItems={[
        { id: 'GEN', label: 'General', hint: 'name, archetype' },
        { id: 'REP', label: 'Repository', hint: 'github + branch' },
        { id: 'GAT', label: 'Merge gates', hint: 'PR comment preview' },
        { id: 'MEM', label: 'Members', hint: '1 owner' },
        { id: 'EXP', label: 'Export & delete', hint: 'tenant export' },
      ]}
      centerNote="Sections render next batch."
    />
  )
}
