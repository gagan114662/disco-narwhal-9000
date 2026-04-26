import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '@/components/page-shell'

export const metadata: Metadata = {
  title: 'Documentation',
  description:
    'Quickstart, concepts, operate, and reference. The full docs site lands with M3.',
}

const SECTIONS = [
  {
    title: 'Quickstart',
    items: [
      'Install Local in 60 seconds',
      'Your first build',
      'Hello, audit pack',
    ],
  },
  {
    title: 'Concepts',
    items: [
      'Spec → Build → Verify',
      'The audit chain',
      'Two-key review',
      'Reconciliation',
    ],
  },
  {
    title: 'Operate',
    items: [
      'Self-host with Helm',
      'Air-gap mode',
      'Customer-supplied LLM',
      'Backup and restore',
    ],
  },
  {
    title: 'Reference',
    items: [
      'CLI reference',
      'REST + WebSocket API',
      'Audit event schema',
      'OpenAPI spec',
    ],
  },
]

export default function DocsPage() {
  return (
    <PageShell
      eyebrow="Documentation"
      title="The docs site lands with M3."
      lede="The structure below is the table of contents we’re writing against. Pages publish incrementally and are announced in the changelog. If a doc you need isn’t on the list, tell us — the docs roadmap is shaped by what design partners ask for."
    >
      <div className="grid md:grid-cols-2 gap-px bg-border border border-border rounded-xl overflow-hidden">
        {SECTIONS.map((s) => (
          <div key={s.title} className="bg-bg p-8">
            <div className="text-xs uppercase tracking-widest text-subtle">{s.title}</div>
            <ul className="mt-4 space-y-3">
              {s.items.map((item) => (
                <li key={item} className="flex items-center justify-between gap-3 text-pretty">
                  <span className="text-fg">{item}</span>
                  <span className="text-[10px] uppercase tracking-widest font-mono text-muted border border-border rounded-full px-2 py-0.5 flex-shrink-0">
                    soon
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-12 max-w-readable text-sm text-muted">
        Want a doc you don’t see here?{' '}
        <Link href="/contact" className="underline underline-offset-4 hover:text-fg">
          Tell us
        </Link>
        .
      </div>
    </PageShell>
  )
}
