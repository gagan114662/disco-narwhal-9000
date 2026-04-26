const STEPS = [
  {
    n: '01',
    title: 'Spec',
    body: 'Write the spec in plain English, or import a Linear or Jira ticket. The agent surfaces high-uncertainty assumptions and asks structured clarifying questions before any code is written.',
    artifacts: ['spec.md', 'evals/spec-id/*.json', 'IP-confirm.signed'],
  },
  {
    n: '02',
    title: 'Build',
    body: 'A builder and an adversarial reviewer run in parallel against the spec. Disagreements gate progress. Generated code traces back to the clause that produced it.',
    artifacts: ['app/**/*.ts', 'audit/events.jsonl', 'reviewer/verdict.json'],
  },
  {
    n: '03',
    title: 'Verify',
    body: 'Eval pack runs on every change. Drift in either direction triggers reconciliation. Hand the audit pack to compliance — append-only today, signed and Merkle-anchored at GA.',
    artifacts: ['audit-pack.tar.gz', 'merkle-root.txt', 'evals/last/run.json'],
  },
]

export function HowItWorks() {
  return (
    <section className="container py-24 md:py-32">
      <div className="max-w-2xl">
        <div className="text-xs uppercase tracking-[0.18em] text-muted">How it works</div>
        <h2 className="display-serif text-display-lg mt-4 text-balance">
          Three steps. One audit chain.
        </h2>
      </div>

      <div className="mt-16 grid md:grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden">
        {STEPS.map((step) => (
          <div key={step.n} className="bg-bg p-8 md:p-10 flex flex-col">
            <div className="font-mono text-xs text-subtle">{step.n}</div>
            <div className="font-serif text-2xl tracking-tight mt-3">{step.title}</div>
            <p className="mt-3 text-muted text-pretty">{step.body}</p>
            <div className="mt-auto pt-8">
              <div className="text-xs uppercase tracking-widest text-subtle">Artifacts</div>
              <ul className="mt-2 font-mono text-[12px] text-muted space-y-1">
                {step.artifacts.map((a) => (
                  <li key={a}>· {a}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
