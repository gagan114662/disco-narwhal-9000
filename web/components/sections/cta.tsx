import Link from 'next/link'

export function CTA() {
  return (
    <section className="container py-24 md:py-32">
      <div className="rounded-2xl border border-border bg-surface p-10 md:p-16 text-center">
        <h2 className="display-serif text-display-lg text-balance max-w-3xl mx-auto">
          Ship the next app the way the last one should have shipped.
        </h2>
        <p className="mt-5 max-w-readable mx-auto text-muted text-pretty">
          Install in a minute. First working app in under thirty. No card. No call.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/start"
            className="inline-flex items-center gap-2 bg-fg text-bg rounded-full px-5 py-3 text-sm hover:opacity-90 transition-opacity"
          >
            Start free
          </Link>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 border border-border rounded-full px-5 py-3 text-sm hover:bg-bg transition-colors"
          >
            Talk to engineering
          </Link>
        </div>
      </div>
    </section>
  )
}
