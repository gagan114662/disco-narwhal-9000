import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '@/components/page-shell'
import { NotifyForm } from '@/components/notify-form'

export const metadata: Metadata = {
  title: 'Careers',
  description:
    'Hiring opens with M2. The first hires after the founder are a Customer Success Engineer and a Security Engineer.',
}

export default function CareersPage() {
  return (
    <PageShell
      eyebrow="Company · Careers"
      title="Hiring opens with M2."
      lede="We are intentionally small until the platform proves itself in production. The first hires after the founder are a Customer Success Engineer and a Security Engineer — both post-M2, both engineering-led roles."
    >
      <div className="max-w-readable space-y-8">
        <p className="text-muted text-pretty">
          If you would have applied to one of those roles a year ago,{' '}
          <Link href="/contact?intent=careers" className="underline underline-offset-4 hover:text-fg">
            tell us
          </Link>{' '}
          — we keep a short list of people we want to talk to as soon as we can hire.
        </p>

        <div className="rounded-xl border border-border bg-surface/40 p-6">
          <div className="text-xs uppercase tracking-widest text-subtle">Get on the list</div>
          <p className="mt-2 text-sm text-fg text-pretty">
            Drop your email and a one-liner about your background. One message when a role opens
            that fits.
          </p>
          <div className="mt-4">
            <NotifyForm intent="careers" cta="Add me" fields={['role']} />
          </div>
        </div>
      </div>
    </PageShell>
  )
}
