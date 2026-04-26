import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '@/components/page-shell'

export const metadata: Metadata = {
  title: 'Security advisories',
  description:
    'Signed advisories with coordinated disclosure. Email subscription available; report a vulnerability privately.',
}

export default function AdvisoriesPage() {
  return (
    <PageShell
      eyebrow="Security · Advisories"
      title="Security advisories."
      lede="No advisories have been published yet. When they are, every signed advisory is announced here, in the RSS feed, and in email to subscribed customers."
    >
      <div className="grid md:grid-cols-2 gap-px bg-border border border-border rounded-xl overflow-hidden">
        <div className="bg-bg p-8">
          <div className="font-serif text-2xl tracking-tight">Subscribe</div>
          <p className="mt-3 text-muted text-pretty">
            Email list available on request — Cloud customers are subscribed by default with the
            contract address. An RSS feed publishes with the first advisory.
          </p>
          <Link
            href="/contact?intent=advisories-subscribe"
            className="mt-6 inline-flex items-center gap-2 text-sm text-fg underline-offset-4 hover:underline"
          >
            Email list →
          </Link>
        </div>
        <div className="bg-bg p-8">
          <div className="font-serif text-2xl tracking-tight">Report a vulnerability</div>
          <p className="mt-3 text-muted text-pretty">
            We acknowledge within 24 hours. We coordinate disclosure on a 90-day default. We credit
            researchers in the published advisory.
          </p>
          <a
            href="mailto:security@kairos-sf.dev"
            className="mt-6 inline-flex items-center gap-2 font-mono text-sm text-fg underline-offset-4 hover:underline"
          >
            security@kairos-sf.dev
          </a>
        </div>
      </div>
    </PageShell>
  )
}
