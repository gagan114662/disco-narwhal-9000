import type { Metadata } from 'next'
import { PageShell } from '@/components/page-shell'

export const metadata: Metadata = {
  title: 'Sub-processors',
  description:
    'Vendors we rely on to deliver the hosted service. Air-gap and self-host deployments rely on none of these.',
}

const SUB_PROCESSORS = [
  { name: 'Anthropic', purpose: 'LLM inference (default provider)', region: 'US' },
  { name: 'AWS (Bedrock + KMS + S3)', purpose: 'Hosted compute, key management, audit storage', region: 'US · EU on Cloud Team' },
  { name: 'Stripe', purpose: 'Subscription billing for Cloud tiers', region: 'US' },
  { name: 'Postmark', purpose: 'Transactional email (auth, notifications, digests)', region: 'US' },
  { name: 'Sentry', purpose: 'Error and performance monitoring', region: 'US' },
  { name: 'Cloudflare', purpose: 'CDN, WAF, DNS, anti-abuse', region: 'Global' },
]

export default function SubProcessorsPage() {
  return (
    <PageShell
      eyebrow="Legal · Sub-processors"
      title="Current sub-processors."
      lede="The vendors we rely on to deliver the hosted service. Air-gap and self-host deployments rely on none of these. Material changes are announced at least 30 days in advance."
    >
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-left">
          <thead className="bg-surface text-xs uppercase tracking-widest text-subtle">
            <tr>
              <th className="px-5 py-3 font-normal">Vendor</th>
              <th className="px-5 py-3 font-normal">Purpose</th>
              <th className="px-5 py-3 font-normal">Region</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {SUB_PROCESSORS.map((s) => (
              <tr key={s.name} className="bg-bg">
                <td className="px-5 py-4 font-serif text-base">{s.name}</td>
                <td className="px-5 py-4 text-muted">{s.purpose}</td>
                <td className="px-5 py-4 font-mono text-xs text-muted">{s.region}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-8 text-sm text-muted max-w-readable">
        Subscribe to changes via the{' '}
        <a href="/security/advisories" className="underline underline-offset-4 hover:text-fg">
          advisories feed
        </a>
        . Cloud Team and Enterprise customers receive direct notification at the address on the
        contract.
      </p>
      <p className="mt-3 text-xs text-subtle">
        v0.1 · Last updated 2026-04-25 · Counsel review in progress. Material additions are
        announced at least 30 days in advance via the advisories feed and direct customer email.
      </p>
    </PageShell>
  )
}
