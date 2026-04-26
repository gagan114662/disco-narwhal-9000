const PROOFS = [
  {
    label: 'Provable spec',
    title: 'The spec is the source of truth — provably.',
    body: 'Every clause auto-generates a gating eval. Every line of code traces back to a clause. Untraceable code raises an audit alarm within 30 seconds.',
    metric: '≥95% eval-pinned correctness',
  },
  {
    label: 'Compounding',
    title: 'The Nth build is measurably better than the 1st.',
    body: 'Outcomes feed a learning loop. Prompt evolution is backtest-gated. The platform gets sharper at the archetypes you actually build.',
    metric: 'Eval-score-per-archetype slope > 0',
  },
  {
    label: 'Two-key review',
    title: 'Builder and reviewer disagree on the record.',
    body: 'Two agents work in parallel. Disagreements gate the workflow with structured questions, not raw diffs. No silent rubber-stamps.',
    metric: 'Reviewer catch-rate ≥80% on planted bugs',
  },
  {
    label: 'Reconciliation',
    title: 'Drift is detected, not assumed away.',
    body: 'Spec changes propose code diffs. Code edits outside the platform propose spec deltas. Both flow through the same gated review queue.',
    metric: 'p99 < 30s at GA · 90s today',
  },
  {
    label: 'On-prem',
    title: 'Single binary. Air-gap from day one.',
    body: 'Helm, docker-compose, or a compiled binary. Customer-supplied LLM endpoint. Network-namespace verified in CI with deny-all egress.',
    metric: 'Air-gap CI lane: green or block',
  },
]

export function Proofs() {
  return (
    <section className="border-t border-border bg-surface/40">
      <div className="container py-24 md:py-32">
        <div className="max-w-2xl">
          <div className="text-xs uppercase tracking-[0.18em] text-muted">Five proofs</div>
          <h2 className="display-serif text-display-lg mt-4 text-balance">
            Better, not just present.
          </h2>
          <p className="mt-5 text-lg text-muted text-pretty">
            Each proof is a measurable claim. Each one gates CI. Each one is a thing you can hand to
            an auditor without a deck.
          </p>
        </div>

        <ol className="mt-16 divide-y divide-border border-y border-border">
          {PROOFS.map((p) => (
            <li
              key={p.label}
              className="grid md:grid-cols-12 gap-6 py-10 px-2 md:px-4"
            >
              <div className="md:col-span-2">
                <span className="text-xs uppercase tracking-widest text-muted">{p.label}</span>
              </div>
              <div className="md:col-span-7">
                <div className="font-serif text-2xl tracking-tight text-balance">{p.title}</div>
                <p className="mt-3 text-muted text-pretty max-w-readable">{p.body}</p>
              </div>
              <div className="md:col-span-3 md:text-right">
                <div className="text-xs uppercase tracking-widest text-subtle">SLO</div>
                <div className="mt-1 font-mono text-sm text-fg">{p.metric}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
