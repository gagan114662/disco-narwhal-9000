import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '@/components/page-shell'

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Per-seat. No build counters. LLM cost passed through with no markup. Local free, Cloud Pro $50/seat/mo, Cloud Team $150/seat/mo, Enterprise from $100k/yr.',
}

type Tier = {
  name: string
  price: string
  priceSub?: string
  for: string
  cta: { label: string; href: string }
  features: string[]
  highlight?: boolean
}

const TIERS: Tier[] = [
  {
    name: 'Local',
    price: 'Free',
    for: 'Individuals · evaluators',
    cta: { label: 'Install', href: '/start' },
    features: [
      'Single-laptop, file-backed',
      'One archetype (CRUD + auth scaffold)',
      'Full audit chain on disk',
      'Apache 2.0 OSS core',
      'Community support',
    ],
  },
  {
    name: 'Cloud Pro',
    price: '$50',
    priceSub: '/seat/mo + LLM cost',
    for: 'Startups · dev teams',
    cta: { label: 'Request access', href: '/contact?tier=cloud-pro' },
    features: [
      'Up to 25 seats',
      'Hosted dashboard',
      'OIDC SSO (Google, Microsoft Entra)',
      'PM-tool inbound (Linear, Jira)',
      'Standard support · 24h first response',
      'Early access today · open trial with M3',
    ],
    highlight: true,
  },
  {
    name: 'Cloud Team',
    price: '$150',
    priceSub: '/seat/mo + LLM cost',
    for: 'Mid-market · governance',
    cta: { label: 'Talk to us', href: '/contact?tier=cloud-team' },
    features: [
      '26–200 seats',
      'SAML, RBAC, custom roles',
      'Audit export · SIEM forward',
      'Compliance pack (SOC2/HIPAA mapping)',
      'Business-hours chat · 4h Sev2',
    ],
  },
  {
    name: 'Enterprise',
    price: 'From $100k',
    priceSub: '/yr',
    for: 'Regulated · air-gap · 200+ seats',
    cta: { label: 'Talk to us', href: '/contact?tier=enterprise' },
    features: [
      'On-prem & air-gap',
      'Customer-managed keys (CMEK)',
      'BAA · FedRAMP-ready posture',
      'Customer-supplied LLM endpoint',
      '24x7 Sev1 · named CSE',
    ],
  },
]

const FAQ = [
  {
    q: 'Why per-seat instead of per-build?',
    a: 'Per-build pricing taxes the platform’s own learning loop — the better it gets, the more it costs you. Per-seat aligns the incentive: we want you to ship more, not bill you for it.',
  },
  {
    q: 'What does “LLM cost pass-through” mean?',
    a: 'You pay your model provider directly, or we pass through the cost at our negotiated rate with no markup. When provider discounts at scale arrive, we share them rather than capture them.',
  },
  {
    q: 'Can I bring my own model?',
    a: 'Yes. The provider abstraction supports Anthropic, Bedrock, Azure OpenAI, and self-hosted vLLM. Enterprise air-gap requires a customer-supplied endpoint by design.',
  },
  {
    q: 'When does Cloud Pro open as a self-serve trial?',
    a: 'Today it is invite-only early access. Self-serve sign-up — 14 days, no card — opens with M3 alongside the public docs site. Request access via the link above and we will route an invite as a slot opens.',
  },
  {
    q: 'I’m between 25 and 200 seats. Which tier?',
    a: 'Cloud Team. The 25-seat ceiling on Cloud Pro is administrative — once you cross it we move you to Team for the SSO/SAML and audit export you’ll need anyway.',
  },
  {
    q: 'How does enterprise procurement work?',
    a: 'We ship a pre-filled procurement pack (SIG Lite, CAIQ, SOC2 prep, sub-processor list, BCP) under NDA. Most security questionnaires take days, not weeks.',
  },
]

export default function PricingPage() {
  return (
    <>
      <PageShell
        eyebrow="Pricing"
        title="Per-seat. No build counters."
        lede="We charge for seats, not for outcomes. LLM cost is passed through at provider rate with no markup. The platform should reward you for shipping more, not bill you for it."
      />

      <section className="container pb-20">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border rounded-xl overflow-hidden">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`bg-bg p-8 flex flex-col ${t.highlight ? 'ring-1 ring-accent ring-inset' : ''}`}
            >
              <div className="flex items-baseline justify-between">
                <div className="font-serif text-2xl tracking-tight">{t.name}</div>
                {t.highlight && (
                  <span className="text-[10px] uppercase tracking-widest text-accent font-mono">
                    Early access
                  </span>
                )}
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-serif text-3xl">{t.price}</span>
                {t.priceSub && (
                  <span className="font-mono text-xs text-muted">{t.priceSub}</span>
                )}
              </div>
              <div className="mt-1 text-sm text-muted">{t.for}</div>
              <ul className="mt-6 space-y-2 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2 text-muted">
                    <span className="text-accent">·</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={t.cta.href}
                className={`mt-8 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm transition-opacity ${
                  t.highlight
                    ? 'bg-fg text-bg hover:opacity-90'
                    : 'border border-border text-fg hover:bg-surface'
                }`}
              >
                {t.cta.label}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-6 text-sm text-subtle max-w-readable">
          Above 200 seats or running in a regulated environment? Talk to us — Enterprise is the
          right tier and the conversation starts with your security review.
        </p>
      </section>

      <section className="container py-20 border-t border-border">
        <div className="grid md:grid-cols-12 gap-10">
          <div className="md:col-span-4">
            <div className="text-xs uppercase tracking-[0.18em] text-muted">Questions</div>
            <h2 className="display-serif text-display-md mt-4 text-balance">
              Frequently asked.
            </h2>
          </div>
          <dl className="md:col-span-7 md:col-start-6 divide-y divide-border border-y border-border">
            {FAQ.map((item) => (
              <div key={item.q} className="py-6">
                <dt className="font-serif text-lg tracking-tight">{item.q}</dt>
                <dd className="mt-2 text-muted text-pretty max-w-readable">{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  )
}
