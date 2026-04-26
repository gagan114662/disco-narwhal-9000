import type { Metadata } from 'next'
import { PageShell } from '@/components/page-shell'

export const metadata: Metadata = {
  title: 'Status',
  description:
    'Public preview status board. Real uptime and incident history publish at GA.',
}

const COMPONENTS = [
  { name: 'Cloud Pro dashboard', status: 'Preview' },
  { name: 'Build orchestrator', status: 'Preview' },
  { name: 'Audit chain ingestion', status: 'Preview' },
  { name: 'LLM provider — Anthropic', status: 'Preview' },
  { name: 'LLM provider — Bedrock VPC', status: 'Preview' },
  { name: 'PM-tool inbound (Linear, Jira)', status: 'Preview' },
]

export default function StatusPage() {
  return (
    <PageShell
      eyebrow="Status"
      title="Public preview."
      lede="The hosted service is in invite-only preview. Real uptime and incident history begin publishing on this page when public Cloud Pro launches with M3. Self-host and air-gap deployments are out of scope by design."
    >
      <div className="overflow-hidden rounded-xl border border-border">
        <ul className="divide-y divide-border">
          {COMPONENTS.map((c) => (
            <li key={c.name} className="bg-bg flex items-center justify-between px-6 py-5">
              <div className="font-serif text-base">{c.name}</div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-subtle" />
                <span className="font-mono text-xs text-muted">{c.status}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-12 grid md:grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden">
        <div className="bg-bg p-6">
          <div className="text-xs uppercase tracking-widest text-subtle">Uptime · 30d</div>
          <div className="mt-2 font-mono text-sm text-muted">— · publishes at GA</div>
        </div>
        <div className="bg-bg p-6">
          <div className="text-xs uppercase tracking-widest text-subtle">Build success · 7d</div>
          <div className="mt-2 font-mono text-sm text-muted">— · publishes at GA</div>
        </div>
        <div className="bg-bg p-6">
          <div className="text-xs uppercase tracking-widest text-subtle">Last incident</div>
          <div className="mt-2 font-mono text-sm text-muted">— · publishes at GA</div>
        </div>
      </div>

      <p className="mt-8 text-sm text-subtle max-w-readable">
        Numbers go live with the public hosted service. Until then, the only honest answer is —.
      </p>
    </PageShell>
  )
}
