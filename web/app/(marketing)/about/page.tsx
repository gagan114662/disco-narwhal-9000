import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '@/components/page-shell'

export const metadata: Metadata = {
  title: 'About',
  description:
    'A small engineering-first team building the platform we wished existed when AI codegen was banned, jailbroken, or quietly tolerated — never trusted.',
}

export default function AboutPage() {
  return (
    <PageShell
      eyebrow="Company"
      title="A small team, building the audit chain."
      lede="We are an engineering-first company shipping the platform we wished existed when we worked inside regulated companies — where AI codegen was either banned, jailbroken, or quietly tolerated, and never trusted."
    >
      <div className="grid md:grid-cols-2 gap-10 max-w-readable">
        <section>
          <div className="text-xs uppercase tracking-widest text-subtle">What we believe</div>
          <p className="mt-3 text-muted text-pretty">
            “Production-ready AI” is a marketing phrase until it produces evidence. The audit chain
            is the evidence. We build the platform that makes the evidence cheap, automatic, and
            handed to you by default.
          </p>
        </section>
        <section>
          <div className="text-xs uppercase tracking-widest text-subtle">How we work</div>
          <p className="mt-3 text-muted text-pretty">
            One archetype until it’s solid. Eval-pinned everything. Two-key review on the platform
            we ship, not just the platform we sell. SLOs gate release. Shipping is the test.
          </p>
        </section>
      </div>

      <section className="mt-16 border-t border-border pt-12">
        <div className="text-xs uppercase tracking-widest text-subtle">Team</div>
        <ul className="mt-6 grid md:grid-cols-2 gap-px bg-border border border-border rounded-xl overflow-hidden">
          <li className="bg-bg p-6">
            <div className="font-serif text-xl tracking-tight">Gagan Arora</div>
            <div className="mt-1 text-sm text-muted">Founder · engineering</div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <a
                href="https://github.com/gagan114662"
                className="font-mono text-muted underline-offset-4 hover:text-fg hover:underline"
              >
                github.com/gagan114662
              </a>
              <a
                href="mailto:gagan@getfoolish.com"
                className="font-mono text-muted underline-offset-4 hover:text-fg hover:underline"
              >
                gagan@getfoolish.com
              </a>
            </div>
          </li>
          <li className="bg-bg p-6">
            <div className="font-serif text-xl tracking-tight">Hiring opens with M2</div>
            <div className="mt-1 text-sm text-muted">CSE · Security · DevRel</div>
            <Link
              href="/careers"
              className="mt-3 inline-flex text-xs font-mono text-muted underline-offset-4 hover:text-fg hover:underline"
            >
              get on the short list →
            </Link>
          </li>
        </ul>
      </section>

      <section className="mt-12 flex flex-wrap gap-3">
        <Link
          href="/contact"
          className="inline-flex items-center gap-2 border border-border rounded-full px-4 py-2 text-sm hover:bg-surface transition-colors"
        >
          Get in touch
        </Link>
        <a
          href="https://github.com/gagan114662/disco-narwhal-9000"
          className="inline-flex items-center gap-2 border border-border rounded-full px-4 py-2 text-sm hover:bg-surface transition-colors"
        >
          Source on GitHub
        </a>
        <Link
          href="/security"
          className="inline-flex items-center gap-2 border border-border rounded-full px-4 py-2 text-sm hover:bg-surface transition-colors"
        >
          Security posture
        </Link>
      </section>
    </PageShell>
  )
}
