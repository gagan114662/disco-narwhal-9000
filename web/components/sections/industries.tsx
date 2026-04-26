const INDUSTRIES = [
  {
    name: 'Healthcare',
    body: 'BAA-ready. PHI never leaves the perimeter. PII tombstoning keeps the audit chain valid through erasure.',
    tags: ['HIPAA', 'BAA', 'CMEK'],
  },
  {
    name: 'Financial services',
    body: 'Right-to-audit honored under NDA. SOC2-prep posture from day one (Type I 6 mo post-GA, Type II at 18). Per-tenant key management with quarterly rotation drills.',
    tags: ['SOC2-prep', 'Customer KMS', '4-eyes deploy'],
  },
  {
    name: 'Public sector',
    body: 'FedRAMP-ready gap doc on day one. OFAC screening on signup. Restricted-country gateway block. Code escrow available.',
    tags: ['FedRAMP-ready', 'OFAC', 'Air-gap'],
  },
  {
    name: 'Mid-market engineering',
    body: 'Bottoms-up adoption. VS Code extension, GitHub App, and Helm chart. Generated code lands as PRs in your repos, not ours.',
    tags: ['Self-host', 'VS Code', 'GitHub App'],
  },
]

export function Industries() {
  return (
    <section className="border-t border-border bg-surface/40">
      <div className="container py-24 md:py-32">
        <div className="max-w-2xl">
          <div className="text-xs uppercase tracking-[0.18em] text-muted">For</div>
          <h2 className="display-serif text-display-lg mt-4 text-balance">
            Teams that have to show their work.
          </h2>
        </div>
        <div className="mt-16 grid md:grid-cols-2 gap-px bg-border border border-border rounded-xl overflow-hidden">
          {INDUSTRIES.map((i) => (
            <div key={i.name} className="bg-bg p-8 md:p-10">
              <div className="font-serif text-2xl tracking-tight">{i.name}</div>
              <p className="mt-3 text-muted text-pretty max-w-readable">{i.body}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {i.tags.map((t) => (
                  <span
                    key={t}
                    className="text-xs font-mono text-muted border border-border rounded-full px-2.5 py-1"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
