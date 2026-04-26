import type { Metadata } from 'next'
import { ModuleStub } from '@/components/app/module-stub'

export const metadata: Metadata = {
  title: 'Validator',
  description:
    'External integration surface — App Key, AI-Assistant ↔ Manual-API toggle, sub-tabs for Integration / Actions / Score Types / Tags, plus an inbox.',
}

export default function ValidatorPage() {
  return (
    <ModuleStub
      paneId="validator"
      module="Validator"
      title="Where signals come in from outside the platform."
      description="Integration page (App Key + paste-prompt textarea), sub-tabs for Actions / Score Types / Tags, and the validator inbox. Full surface lands next batch — the data shape and integration model are scoped."
      leftTreeTitle="Sub-tabs"
      leftTreeItems={[
        { id: 'INT', label: 'Integration', hint: 'app key + connector mode' },
        { id: 'ACT', label: 'Actions', hint: '0 configured' },
        { id: 'SCO', label: 'Score Types', hint: '0 configured' },
        { id: 'TAG', label: 'Tags', hint: '0 configured' },
        { id: 'INB', label: 'Inbox', hint: '0 pending' },
      ]}
      centerNote="Integration form + inbox land next batch."
      agentTitle="Validator agent"
      agentBanner={{
        tone: 'info',
        text: 'No App Key configured yet. Generate one to start receiving validations.',
      }}
    />
  )
}
