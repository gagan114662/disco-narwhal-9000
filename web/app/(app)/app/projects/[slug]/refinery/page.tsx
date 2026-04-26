import type { Metadata } from 'next'
import { ModuleStub } from '@/components/app/module-stub'
import { REQUIREMENTS } from '@/lib/app-data'

export const metadata: Metadata = {
  title: 'Refinery',
  description: 'Refine product overview and feature requirements. Tree on the left, editor in the center.',
}

export default function RefineryPage() {
  const productOverview = REQUIREMENTS.filter((r) => r.group === 'product_overview')
  const features = REQUIREMENTS.filter((r) => r.group === 'feature_requirement')
  const items = [
    ...productOverview.map((r) => ({ id: r.id, label: r.title, hint: 'Product overview' })),
    ...features.map((r) => ({ id: r.id, label: r.title, hint: 'Feature requirement' })),
  ]

  return (
    <ModuleStub
      paneId="refinery"
      module="Refinery"
      title="Plain-English requirements, kept clean."
      description="Edit the spec, attach obligations, and ship a confirmed clause set into Foundry. The full editor (Tiptap-grade rich text, drag reorder, slash menu, empty states) lands in the next batch."
      leftTreeTitle="Requirements"
      leftTreeItems={items}
      centerNote="Editor pane lands next batch."
      agentTitle="Refinery agent"
      agentBanner={{
        tone: 'info',
        text: '6 requirements indexed. Ask for clarifications, summary, or obligation suggestions.',
      }}
      agentPinned={productOverview.map((r) => ({
        id: r.id,
        kind: 'requirement' as const,
        label: r.title,
      }))}
    />
  )
}
