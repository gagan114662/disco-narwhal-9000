import type { Metadata } from 'next'
import { PageShell } from '@/components/page-shell'
import { NotifyForm } from '@/components/notify-form'

export const metadata: Metadata = {
  title: 'Community',
  description:
    'Community Discord and GitHub Discussions launch alongside the OSS self-host beta. Notify me on launch.',
}

export default function CommunityPage() {
  return (
    <PageShell
      eyebrow="Resources · Community"
      title="Discord opens with M2."
      lede="The community Discord and GitHub Discussions launch alongside the OSS self-host beta. Channels include #help, #self-host, #archetypes, #show-and-tell, and monthly office hours with engineering."
    >
      <div className="max-w-readable space-y-8">
        <p className="text-muted text-pretty">
          If you’re a design partner today, you have a private channel — check your invite email.
        </p>

        <div className="rounded-xl border border-border bg-surface/40 p-6">
          <div className="text-xs uppercase tracking-widest text-subtle">Notify me on launch</div>
          <p className="mt-2 text-sm text-fg text-pretty">
            One invite when the Discord and Discussions go public.
          </p>
          <div className="mt-4">
            <NotifyForm intent="community" cta="Notify me" />
          </div>
        </div>
      </div>
    </PageShell>
  )
}
