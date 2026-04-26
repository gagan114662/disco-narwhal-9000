import Link from 'next/link'
import { DemoConsole } from './demo-console'

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="container pt-20 pb-20 md:pt-24 md:pb-24">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-12 items-start">
          <div className="lg:col-span-5">
            <div className="text-xs uppercase tracking-[0.18em] text-muted">
              For regulated teams
            </div>
            <h1 className="display-serif text-display-xl mt-6 text-balance">
              AI is shipping your code. Can you prove what shipped?
            </h1>
            <p className="mt-6 max-w-readable text-lg text-muted text-pretty">
              A builder and a reviewer work in parallel against your spec. Disagreements gate
              progress. Every clause traces to code. The audit chain is the receipt — handed to
              you, not asserted at you.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                href="/start"
                className="inline-flex items-center gap-2 bg-fg text-bg rounded-full px-5 py-3 text-sm hover:opacity-90 transition-opacity"
              >
                Start a build
                <Arrow />
              </Link>
              <Link
                href="/app"
                className="inline-flex items-center gap-2 border border-border rounded-full px-5 py-3 text-sm text-fg hover:bg-surface transition-colors"
              >
                See it run
              </Link>
            </div>
            <Link
              href="/status"
              className="mt-6 inline-flex items-center gap-2 text-xs font-mono text-muted hover:text-fg transition-colors"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Public preview · self-serve at M3
            </Link>
          </div>
          <div className="lg:col-span-7">
            <DemoConsole />
          </div>
        </div>
      </div>
    </section>
  )
}

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}
