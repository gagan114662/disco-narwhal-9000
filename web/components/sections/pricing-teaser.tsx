import Link from 'next/link'

const TIERS = [
  {
    name: 'Local',
    price: 'Free',
    priceSub: '',
    seats: 'Single laptop',
    for: 'Individuals · evaluators',
  },
  {
    name: 'Cloud Pro',
    price: '$50',
    priceSub: '/seat/mo + LLM cost',
    seats: 'Up to 25 seats',
    for: 'Startups · early access',
  },
  {
    name: 'Cloud Team',
    price: '$150',
    priceSub: '/seat/mo + LLM cost',
    seats: '26–200 seats',
    for: 'Mid-market · governance',
  },
  {
    name: 'Enterprise',
    price: 'From $100k',
    priceSub: '/yr',
    seats: '200+ seats',
    for: 'Regulated · air-gap · BAA',
  },
]

export function PricingTeaser() {
  return (
    <section className="border-t border-border bg-surface/40">
      <div className="container py-24 md:py-32">
        <div className="grid md:grid-cols-12 gap-10">
          <div className="md:col-span-4">
            <div className="text-xs uppercase tracking-[0.18em] text-muted">Pricing</div>
            <h2 className="display-serif text-display-lg mt-4 text-balance">
              Per-seat. No build counters.
            </h2>
            <p className="mt-5 text-muted max-w-readable text-pretty">
              We charge for seats, not for outcomes. LLM cost is passed through at provider rate
              with no markup. The platform should reward you for shipping more, not bill you.
            </p>
            <Link
              href="/pricing"
              className="mt-6 inline-flex items-center gap-2 text-sm text-fg underline-offset-4 hover:underline"
            >
              See full pricing →
            </Link>
          </div>
          <div className="md:col-span-8">
            <div className="grid sm:grid-cols-2 gap-px bg-border border border-border rounded-xl overflow-hidden">
              {TIERS.map((t) => (
                <div key={t.name} className="bg-bg p-6">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="font-serif text-xl tracking-tight">{t.name}</div>
                    <div className="font-mono text-xs text-muted text-right">
                      <span className="text-fg">{t.price}</span>
                      {t.priceSub}
                    </div>
                  </div>
                  <div className="mt-2 font-mono text-[11px] text-subtle">{t.seats}</div>
                  <div className="mt-1 text-sm text-muted">{t.for}</div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-subtle">
              Above 200 seats or running in a regulated environment? Enterprise is the right tier.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
