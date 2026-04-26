import type { Metadata } from 'next'
import { PageShell } from '@/components/page-shell'
import { NotifyForm } from '@/components/notify-form'

export const metadata: Metadata = {
  title: 'Changelog',
  description:
    'Every release has an entry here. Cadence after M3: weekly minor entries, monthly state-of-platform notes.',
}

const ENTRIES = [
  {
    date: '2026-04-25',
    tag: 'preview',
    title: 'Public preview site',
    body: 'Marketing surface, security posture, pricing, legal pack, and procurement pack land for review. Local install instructions and Cloud Pro early-access requests open. Status board publishes preview-state component health; real uptime begins at M3.',
  },
  {
    date: '2026-04-18',
    tag: 'platform',
    title: 'Build draft state machine',
    body: 'Per-build manifest, append-only event log, tracer-slice state machine, atomic + write-queued persistence, schema-validated reads. Dependency-injectable I/O for deterministic tests. Internal milestone toward the spec → build vertical.',
  },
  {
    date: '2026-04-11',
    tag: 'platform',
    title: 'Audit chain v0',
    body: 'Append-only audit log per project, schema validation on read and write, atomic file writes via tmp + rename. Hash-linking and PII tombstoning land next.',
  },
  {
    date: '2026-04-04',
    tag: 'platform',
    title: 'LLM provider abstraction',
    body: 'Typed provider interface across Anthropic, Bedrock, Azure OpenAI, and self-hosted vLLM. Per-tenant warm pools with no cross-tenant context reuse. Cost-ledger primitives wired for the per-tenant cap and 80% alert.',
  },
  {
    date: '2026-03-28',
    tag: 'platform',
    title: 'Workflow engine + chaos lane',
    body: 'Durable execution with idempotent steps and resumable runs. CI now runs a chaos lane that injects step failures and verifies replay-to-completion. Foundation for the two-key review topology.',
  },
  {
    date: '2026-03-21',
    tag: 'platform',
    title: 'Storage spine + tenant isolation',
    body: 'tenant_id required at the storage layer, enforced by schema and verified by chaos tests. Cross-tenant isolation tests run on every PR; one leak halts release.',
  },
]

export default function ChangelogPage() {
  return (
    <PageShell
      eyebrow="Changelog"
      title="What shipped, when."
      lede="Every release has an entry here. Material customer-facing changes are also announced via the changelog feed and to subscribed Cloud customers by email. Cadence after M3: weekly minor entries, monthly state-of-platform notes."
    >
      <div className="mb-10 rounded-xl border border-border bg-surface/40 p-6 max-w-readable">
        <div className="text-xs uppercase tracking-widest text-subtle">Subscribe</div>
        <p className="mt-2 text-sm text-fg text-pretty">
          One email per release. Skip the noise; get the receipts.
        </p>
        <div className="mt-4">
          <NotifyForm intent="changelog" cta="Subscribe" />
        </div>
      </div>

      <ol className="divide-y divide-border border-y border-border">
        {ENTRIES.map((e) => (
          <li key={e.date} className="grid md:grid-cols-12 gap-4 py-8">
            <div className="md:col-span-2">
              <div className="font-mono text-xs text-subtle">{e.date}</div>
              <div className="mt-1 text-[10px] uppercase tracking-widest text-accent">{e.tag}</div>
            </div>
            <div className="md:col-span-9">
              <div className="font-serif text-xl tracking-tight">{e.title}</div>
              <p className="mt-2 text-muted text-pretty max-w-readable">{e.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </PageShell>
  )
}
