const FACTS = [
  { k: 'Tenant isolation', v: '100.000% — chaos-tested in CI' },
  { k: 'Audit chain integrity', v: '100.000% — any failure pages' },
  { k: 'Drift detection p99', v: '< 30s at GA · 90s today' },
  { k: 'Backup restore drill', v: 'Monthly — failed = ship-block' },
  { k: 'Prompt-injection battery', v: '50+ attacks · 100% neutralized' },
  { k: 'License scanner', v: 'GPL/AGPL fragments blocked at accept' },
]

export function SecurityBand() {
  return (
    <section className="container py-24 md:py-32">
      <div className="grid md:grid-cols-12 gap-10 items-start">
        <div className="md:col-span-5">
          <div className="text-xs uppercase tracking-[0.18em] text-muted">Security & on-prem</div>
          <h2 className="display-serif text-display-lg mt-4 text-balance">
            Compliance as artifacts, not assertions.
          </h2>
          <p className="mt-5 text-lg text-muted text-pretty max-w-readable">
            We ship the posture, not the slide deck. Every claim below has a corresponding test, a
            corresponding runbook, and a corresponding line in the audit chain.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="/security"
              className="inline-flex items-center gap-2 border border-border rounded-full px-4 py-2 text-sm hover:bg-surface transition-colors"
            >
              Trust portal
            </a>
            <a
              href="/security/advisories"
              className="inline-flex items-center gap-2 border border-border rounded-full px-4 py-2 text-sm hover:bg-surface transition-colors"
            >
              Advisories
            </a>
            <a
              href="/legal/sub-processors"
              className="inline-flex items-center gap-2 border border-border rounded-full px-4 py-2 text-sm hover:bg-surface transition-colors"
            >
              Sub-processors
            </a>
          </div>
        </div>
        <div className="md:col-span-7">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border border border-border rounded-xl overflow-hidden">
            {FACTS.map((f) => (
              <div key={f.k} className="bg-bg p-6">
                <dt className="text-xs uppercase tracking-widest text-subtle">{f.k}</dt>
                <dd className="mt-2 font-mono text-sm text-fg">{f.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}
