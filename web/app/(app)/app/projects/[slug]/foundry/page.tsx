import type { Metadata } from 'next'
import { ModuleStub } from '@/components/app/module-stub'
import { BLUEPRINTS } from '@/lib/app-data'

export const metadata: Metadata = {
  title: 'Foundry',
  description:
    'Blueprints with prose ↔ formal toggle. Foundation, system, and feature blueprints in the tree.',
}

export default function FoundryPage() {
  const items = BLUEPRINTS.map((b) => ({
    id: b.id,
    label: b.title,
    hint: `${b.group} · ${b.diagramKind ?? 'no diagram'}`,
  }))

  return (
    <ModuleStub
      paneId="foundry"
      module="Foundry"
      title="From requirements to architectural shape."
      description="Foundation blueprints (tenancy, audit), system blueprints (workflows), feature blueprints (schemas + actions). Prose-view ↔ formal-view toggle and diagram pane (ERD / sequence / architecture) land in the next batch — the data model is in place."
      leftTreeTitle="Blueprints"
      leftTreeItems={items}
      centerNote="Prose / formal toggle and diagram pane land next batch."
      agentTitle="Foundry agent"
      agentBanner={{
        tone: 'info',
        text: '4 blueprints linked to 6 requirements and 5 obligations.',
      }}
      agentPinned={BLUEPRINTS.slice(0, 2).map((b) => ({
        id: b.id,
        kind: 'blueprint' as const,
        label: b.title,
      }))}
    />
  )
}
