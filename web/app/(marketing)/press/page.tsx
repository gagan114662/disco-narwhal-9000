import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '@/components/page-shell'

export const metadata: Metadata = {
  title: 'Press',
  description:
    'Briefings on request for analysts and journalists covering AI codegen, regulated-industry adoption, and audit-chain primitives.',
}

const TOPICS = [
  {
    title: 'Provable AI codegen',
    body: 'Why "production-ready" is a measurable claim, not a marketing one. Eval-pinning, audit chains, and the difference between drift detection and drift assertion.',
  },
  {
    title: 'Regulated-industry adoption',
    body: 'What changes when AI codegen has to survive procurement: BAA, customer-managed keys, on-prem, and the audit chain as the procurement artifact.',
  },
  {
    title: 'Two-key review as architecture',
    body: 'Builder + reviewer agents disagreeing on the record — what it costs, what it catches, and why a single-agent pipeline is structurally weaker than a two-agent one.',
  },
]

export default function PressPage() {
  return (
    <PageShell
      eyebrow="Company · Press"
      title="Briefings on request."
      lede="We don’t run an open press office. Analysts and journalists working on stories about AI codegen, regulated-industry adoption, or audit-chain primitives can reach the founder directly."
    >
      <section>
        <div className="text-xs uppercase tracking-widest text-subtle">Topics we’ll go on the record about</div>
        <ul className="mt-6 grid md:grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden">
          {TOPICS.map((t) => (
            <li key={t.title} className="bg-bg p-6">
              <div className="font-serif text-lg tracking-tight">{t.title}</div>
              <p className="mt-2 text-sm text-muted text-pretty">{t.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12 grid md:grid-cols-2 gap-10 max-w-readable">
        <div>
          <div className="text-xs uppercase tracking-widest text-subtle">Coverage</div>
          <p className="mt-3 text-muted text-pretty">
            None yet — we’re pre-launch. Analyst and press coverage is listed here as it lands,
            with original links and dates.
          </p>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-subtle">Reach us</div>
          <a
            href="mailto:press@kairos-sf.dev"
            className="mt-3 inline-flex font-mono text-sm text-fg underline underline-offset-4"
          >
            press@kairos-sf.dev
          </a>
          <div className="mt-2 text-xs text-subtle">
            Or via{' '}
            <Link href="/contact?intent=press" className="underline underline-offset-4 hover:text-fg">
              the contact desks
            </Link>
            .
          </div>
        </div>
      </section>
    </PageShell>
  )
}
