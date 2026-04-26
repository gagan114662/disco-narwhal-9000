import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '@/components/page-shell'
import { NotifyForm } from '@/components/notify-form'

export const metadata: Metadata = {
  title: 'Blog',
  description:
    'Engineering posts, build-quality reports with real eval-score trends, and customer stories. Opens with M2.',
}

export default function BlogPage() {
  return (
    <PageShell
      eyebrow="Resources · Blog"
      title="Blog opens with M2."
      lede="Engineering posts, build-quality reports with real eval-score trends, and customer stories. Cadence: weekly engineering, monthly customer, quarterly state-of-platform."
    >
      <div className="max-w-readable space-y-8">
        <p className="text-muted text-pretty">
          Until we publish, the closest thing to “our blog” is the changelog —{' '}
          <Link href="/changelog" className="underline underline-offset-4 hover:text-fg">
            /changelog
          </Link>
          .
        </p>

        <div className="rounded-xl border border-border bg-surface/40 p-6">
          <div className="text-xs uppercase tracking-widest text-subtle">Get the first post</div>
          <p className="mt-2 text-sm text-fg text-pretty">
            One email when we publish. No drip, no spam. Unsubscribe in one click.
          </p>
          <div className="mt-4">
            <NotifyForm intent="blog" cta="Notify me" />
          </div>
        </div>
      </div>
    </PageShell>
  )
}
