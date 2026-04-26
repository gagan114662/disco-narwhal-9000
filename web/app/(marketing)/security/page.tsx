import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '@/components/page-shell'

export const metadata: Metadata = {
  title: 'Security & on-prem',
  description:
    'Compliance as artifacts, not assertions. On-prem from day one, air-gap verified in CI, customer-managed keys, procurement pack ready.',
}

const POSTURE = [
  { k: 'Tenant isolation', v: '100.000% — chaos-tested in CI' },
  { k: 'Audit chain integrity', v: '100.000% — any failure pages' },
  { k: 'Drift detection p99', v: '< 30s at GA · 90s today' },
  { k: 'Backup restore drill', v: 'Monthly — failed = ship-block' },
  { k: 'Prompt-injection battery', v: '50+ attacks · 100% neutralized' },
  { k: 'License scanner', v: 'GPL/AGPL fragments blocked at accept' },
  { k: 'Cross-region failover', v: 'RTO 30 min · RPO 5 min' },
  { k: 'Right-to-audit', v: 'Honored under NDA per Enterprise contract' },
]

const ON_PREM = [
  'Single binary install (`kairos.tar.gz`) or Helm chart on stock EKS / GKE / AKS.',
  'Customer-supplied LLM endpoint — vLLM, Bedrock VPC, Azure OpenAI, or Anthropic direct.',
  'Network-namespace verified in CI: deny-all egress except the LLM endpoint.',
  'Customer-managed encryption keys (CMEK) with quarterly rotation drill.',
  'OFAC screening on tenant signup. Restricted-country block at the gateway.',
  'OTel emission to your existing Honeycomb / Datadog / Splunk.',
]

const PROCUREMENT = [
  { ask: 'SIG Lite / SIG Core', status: 'Pre-filled, refreshed quarterly' },
  { ask: 'CAIQ (CSA)', status: 'Self-assessment in trust portal' },
  { ask: 'SOC2 Type II', status: 'Type I in 6 mo post-GA · Type II at 18 mo' },
  { ask: 'HIPAA BAA', status: 'Available on Enterprise' },
  { ask: 'FedRAMP', status: 'Ready posture · authorization on sponsor' },
  { ask: 'Pentest report', status: 'Annual third-party · shareable under NDA' },
  { ask: 'Cyber liability', status: '$5M minimum · certificate on request' },
  { ask: 'Code escrow', status: 'Available · OSS self-host moots most cases' },
]

export default function SecurityPage() {
  return (
    <>
      <PageShell
        eyebrow="Security & on-prem"
        title="Compliance as artifacts, not assertions."
        lede="We ship the posture, not the slide deck. Every claim below has a corresponding test, a runbook, and a line in the audit chain."
      >
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border rounded-xl overflow-hidden">
          {POSTURE.map((f) => (
            <div key={f.k} className="bg-bg p-6">
              <dt className="text-xs uppercase tracking-widest text-subtle">{f.k}</dt>
              <dd className="mt-2 font-mono text-sm text-fg">{f.v}</dd>
            </div>
          ))}
        </dl>
      </PageShell>

      <section className="container py-20 md:py-24">
        <div className="grid md:grid-cols-12 gap-10">
          <div className="md:col-span-4">
            <div className="text-xs uppercase tracking-[0.18em] text-muted">On-prem & air-gap</div>
            <h2 className="display-serif text-display-md mt-4 text-balance">
              Runs inside your perimeter, not next to it.
            </h2>
          </div>
          <div className="md:col-span-7 md:col-start-6">
            <ul className="space-y-4">
              {ON_PREM.map((line, i) => (
                <li key={i} className="flex gap-3 text-pretty">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-accent flex-shrink-0" />
                  <span className="text-muted">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="container py-20 md:py-24 border-t border-border">
        <div className="grid md:grid-cols-12 gap-10">
          <div className="md:col-span-4">
            <div className="text-xs uppercase tracking-[0.18em] text-muted">Procurement</div>
            <h2 className="display-serif text-display-md mt-4 text-balance">
              The pack your security team will ask for.
            </h2>
            <p className="mt-4 text-muted text-pretty max-w-readable">
              Pre-filled responses, refreshed quarterly. NDA-gated where the framework requires it.
              Available on request to anyone in active evaluation.
            </p>
            <Link
              href="/contact"
              className="mt-6 inline-flex items-center gap-2 text-sm text-fg underline-offset-4 hover:underline"
            >
              Request the pack →
            </Link>
          </div>
          <div className="md:col-span-7 md:col-start-6">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border border border-border rounded-xl overflow-hidden">
              {PROCUREMENT.map((p) => (
                <div key={p.ask} className="bg-bg p-5">
                  <dt className="font-serif text-base">{p.ask}</dt>
                  <dd className="mt-1 font-mono text-xs text-muted">{p.status}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </>
  )
}
