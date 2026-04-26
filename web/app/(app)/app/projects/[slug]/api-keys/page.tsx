import type { Metadata } from 'next'
import { ModuleStub } from '@/components/app/module-stub'

export const metadata: Metadata = {
  title: 'API keys',
  description: 'Per-project API keys for the validator integration and outbound webhooks.',
}

export default function ApiKeysPage() {
  return (
    <ModuleStub
      paneId="api-keys"
      module="Project · API keys"
      title="Per-project keys for validator + webhooks."
      description="No keys generated yet. Key creation, rotation, and per-key scope land in the next batch — schema and audit-event shape are scoped."
      leftTreeTitle="Categories"
      leftTreeItems={[
        { id: 'VAL', label: 'Validator', hint: '0 keys' },
        { id: 'WH', label: 'Outbound webhooks', hint: '0 keys' },
        { id: 'CI', label: 'CI checks', hint: '0 keys' },
      ]}
      centerNote="Key creation + rotation lands next batch."
    />
  )
}
