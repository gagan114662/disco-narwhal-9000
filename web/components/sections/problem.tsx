const POINTS = [
  {
    title: 'Generated code rots',
    body: 'Day-one output looks fine. Six weeks later the spec has moved, the code has been edited outside the platform, and nobody can tell what still matches what.',
  },
  {
    title: 'Reviews are rubber-stamped',
    body: 'A single agent ships a single answer. Adversarial review is ad-hoc, run by whichever engineer happens to look — if anyone looks at all.',
  },
  {
    title: 'Compliance is a story, not a record',
    body: 'When the auditor asks why the system did X, the answer is a chat log and a vibe. There is no chain of evidence from spec clause to deployed line.',
  },
  {
    title: 'Hosted-only is a non-starter',
    body: 'Regulated data cannot leave the perimeter. Most platforms ship a SaaS dashboard and a long roadmap toward on-prem. The roadmap never ships.',
  },
]

export function Problem() {
  return (
    <section className="container py-24 md:py-32">
      <div className="grid md:grid-cols-12 gap-10">
        <div className="md:col-span-4">
          <div className="text-xs uppercase tracking-[0.18em] text-muted">The gap</div>
          <h2 className="display-serif text-display-lg mt-4 text-balance">
            "Production-ready AI" is asserted, not proven.
          </h2>
        </div>
        <div className="md:col-span-7 md:col-start-6">
          <p className="text-lg text-muted text-pretty max-w-readable">
            Every platform in this category claims it ships working software from a spec. None of them
            can show you, on the record, that what shipped is what was asked for — or that it still is.
          </p>
          <ul className="mt-12 grid sm:grid-cols-2 gap-x-8 gap-y-10">
            {POINTS.map((p) => (
              <li key={p.title}>
                <div className="font-serif text-xl tracking-tight">{p.title}</div>
                <p className="mt-2 text-muted text-pretty">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
