import type { Metadata } from 'next'
import { ModuleStub } from '@/components/app/module-stub'
import { OBLIGATIONS, REQUIREMENTS, BLUEPRINTS, WORK_ORDERS } from '@/lib/app-data'

export const metadata: Metadata = {
  title: 'Artifacts',
  description: 'Every artifact this project produces — specs, blueprints, work orders, obligations, audit pack.',
}

export default function ArtifactsPage() {
  return (
    <ModuleStub
      paneId="artifacts"
      module="Project · Artifacts"
      title="Every artifact, in one place."
      description="Specs, blueprints, work orders, obligations, audit chain, compliance pack. Each item lists its hash and last-changed timestamp; click through to the right module."
      leftTreeTitle="By kind"
      leftTreeItems={[
        { id: 'REQ', label: 'Requirements', hint: `${REQUIREMENTS.length} items` },
        { id: 'BP', label: 'Blueprints', hint: `${BLUEPRINTS.length} items` },
        { id: 'WO', label: 'Work orders', hint: `${WORK_ORDERS.length} items` },
        { id: 'OB', label: 'Obligations', hint: `${OBLIGATIONS.length} items` },
        { id: 'AUD', label: 'Audit pack', hint: '1 sealed export' },
      ]}
      centerNote="Artifact catalog with hashes lands next batch."
    />
  )
}
