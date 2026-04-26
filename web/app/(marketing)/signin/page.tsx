import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '@/components/page-shell'

export const metadata: Metadata = {
  title: 'Sign in',
  description:
    'Cloud Pro is in invite-only early access. Local installs run without an account.',
}

export default function SignInPage() {
  return (
    <PageShell
      eyebrow="Sign in"
      title="Cloud Pro is in early access."
      lede="Hosted sign-in is invite-only during preview. Local installs run without an account — your specs and audit chain stay on your machine. If you have a Cloud Pro invite, your link is in your email."
    >
      <div className="grid md:grid-cols-2 gap-px bg-border border border-border rounded-xl overflow-hidden">
        <div className="bg-bg p-8">
          <div className="font-serif text-2xl tracking-tight">Local install</div>
          <p className="mt-3 text-muted text-pretty">
            No account. No sign-in. Your data stays on your machine.
          </p>
          <Link
            href="/start"
            className="mt-6 inline-flex items-center gap-2 text-sm text-fg underline-offset-4 hover:underline"
          >
            Install Local →
          </Link>
        </div>
        <div className="bg-bg p-8">
          <div className="font-serif text-2xl tracking-tight">Cloud Pro</div>
          <p className="mt-3 text-muted text-pretty">
            Invite-only today. Self-serve sign-up — 14 days, no card — opens with M3.
          </p>
          <Link
            href="/contact?intent=cloud-pro-access"
            className="mt-6 inline-flex items-center gap-2 text-sm text-fg underline-offset-4 hover:underline"
          >
            Request access →
          </Link>
        </div>
      </div>
    </PageShell>
  )
}
