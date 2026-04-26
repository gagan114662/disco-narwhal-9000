import type { Metadata } from 'next'
import { PageShell } from '@/components/page-shell'
import { NotifyForm } from '@/components/notify-form'

export const metadata: Metadata = {
  title: 'Research notes',
  description:
    'Technical write-ups on what we’re learning building the platform: eval-pinning, reviewer prompt evolution, drift detection, air-gap CI. First batch publishes with M2.',
}

export default function ResearchPage() {
  return (
    <PageShell
      eyebrow="Resources · Research notes"
      title="Notes from the field."
      lede="Short, technical write-ups on what we’re learning building the platform: eval-pinning failure modes, reviewer prompt evolution, drift-detection benchmarks, air-gap CI design. First batch publishes with M2."
    >
      <div className="max-w-readable space-y-8">
        <p className="text-muted text-pretty">
          We will not publish vendor-comparison benchmarks; we will publish our own eval-score trends
          and the methodology behind them so you can reproduce the numbers.
        </p>

        <div className="rounded-xl border border-border bg-surface/40 p-6">
          <div className="text-xs uppercase tracking-widest text-subtle">Get the first batch</div>
          <p className="mt-2 text-sm text-fg text-pretty">
            One email when the first notes ship. Methodology and reproducible scripts included.
          </p>
          <div className="mt-4">
            <NotifyForm intent="research" cta="Notify me" />
          </div>
        </div>
      </div>
    </PageShell>
  )
}
