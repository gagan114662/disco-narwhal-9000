import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '@/components/page-shell'

export const metadata: Metadata = {
  title: 'Get started',
  description:
    'Two ways in. Run KAIROS-SF locally as an OSS install, or have us run it for you via Cloud Pro early access or an Enterprise PoC.',
}

export default function StartPage() {
  return (
    <PageShell
      eyebrow="Get started"
      title="Two ways in. Pick the one that fits."
      lede="Run it locally today, or have us run it for you. Both paths produce the same audit chain on the same archetype — the only difference is whose machine the daemon lives on."
    >
      <div className="grid lg:grid-cols-2 gap-px bg-border border border-border rounded-xl overflow-hidden">
        {/* Lane 1 — Local, true self-serve */}
        <div className="bg-bg p-8 md:p-10 flex flex-col">
          <div className="text-xs uppercase tracking-widest text-subtle">Run it locally</div>
          <div className="font-serif text-2xl tracking-tight mt-3 text-balance">
            Install in a minute. First app in thirty.
          </div>
          <p className="mt-3 text-muted text-pretty max-w-readable">
            Apache 2.0 OSS core. File-backed, single-laptop. No account, no telemetry by default,
            no network calls except to the LLM endpoint you configure.
          </p>
          <pre className="mt-6 rounded-md bg-surface border border-border p-4 font-mono text-xs leading-relaxed overflow-x-auto">
            <div>$ brew install kairos</div>
            <div>$ kairos build &quot;internal leave-request app&quot;</div>
          </pre>
          <Link
            href="/docs"
            className="mt-auto pt-8 inline-flex items-center gap-2 text-sm text-fg underline-offset-4 hover:underline"
          >
            Read the install guide →
          </Link>
        </div>

        {/* Lane 2 — Run it on us, two sub-options */}
        <div className="bg-bg p-8 md:p-10 flex flex-col">
          <div className="text-xs uppercase tracking-widest text-subtle">Run it on us</div>

          <section className="mt-3">
            <div className="font-serif text-2xl tracking-tight text-balance">
              Cloud Pro · early access
            </div>
            <p className="mt-3 text-muted text-pretty max-w-readable">
              Hosted dashboard, sample-spec library, OIDC SSO, PM-tool inbound. Invite-only during
              preview; self-serve sign-up — 14 days, no card — opens with M3.
            </p>
            <Link
              href="/contact?intent=cloud-pro-access"
              className="mt-4 inline-flex items-center gap-2 text-sm text-fg underline-offset-4 hover:underline"
            >
              Request access →
            </Link>
          </section>

          <div className="my-8 border-t border-border" />

          <section>
            <div className="font-serif text-2xl tracking-tight text-balance">
              Enterprise PoC · on-prem in a week
            </div>
            <p className="mt-3 text-muted text-pretty max-w-readable">
              Helm chart into your K8s, customer-supplied LLM endpoint, named CSE for the duration.
              Ends with a signed audit-pack and a procurement pack.
            </p>
            <Link
              href="/contact?tier=enterprise"
              className="mt-4 inline-flex items-center gap-2 text-sm text-fg underline-offset-4 hover:underline"
            >
              Talk to engineering →
            </Link>
          </section>
        </div>
      </div>

      <div className="mt-10 rounded-xl border border-dashed border-border p-6 md:p-8">
        <div className="grid md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-9">
            <div className="text-xs uppercase tracking-widest text-subtle">On-prem from day one</div>
            <p className="mt-2 text-fg text-pretty max-w-readable">
              Run it inside your perimeter, with your keys, against your LLM endpoint. Network
              namespace verified in CI with deny-all egress except your provider.
            </p>
          </div>
          <div className="md:col-span-3 md:text-right">
            <Link
              href="/security"
              className="inline-flex items-center gap-2 text-sm text-fg underline-offset-4 hover:underline"
            >
              Air-gap brief →
            </Link>
          </div>
        </div>
      </div>
    </PageShell>
  )
}
