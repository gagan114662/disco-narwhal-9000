import type { Metadata } from 'next'
import { PageShell } from '@/components/page-shell'

export const metadata: Metadata = {
  title: 'Telemetry',
  description:
    'OSS self-host: opt-in. Cloud: collected and disclosed in-app. Air-gap: nothing leaves your perimeter, by design.',
}

const COLLECTED = [
  { what: 'Daemon version', why: 'Surface to debug regressions tied to a specific release.' },
  { what: 'OS and architecture', why: 'Triage platform-specific bugs (macOS / Linux / Windows).' },
  { what: 'CLI command names', why: 'Understand which subcommands are used; never the arguments.' },
  { what: 'Anonymous install id', why: 'De-duplicate counts. No PII, no machine identifier.' },
  { what: 'Aggregate latency', why: 'P50/P99 timings on critical paths to keep them honest.' },
  { what: 'Error class', why: 'Top-level error name, never the message body or stack content.' },
]

const NOT_COLLECTED = [
  'Spec contents.',
  'Generated code.',
  'Audit chain entries.',
  'CLI argument values.',
  'Environment variables.',
  'File paths or directory contents.',
  'LLM prompts or completions.',
]

export default function TelemetryPage() {
  return (
    <PageShell
      eyebrow="Legal · Telemetry"
      title="What we collect, what we don’t."
      lede="OSS self-host: opt-in. Cloud: collected and disclosed in-app. Air-gap: nothing leaves your perimeter, by design."
    >
      <div className="grid md:grid-cols-2 gap-px bg-border border border-border rounded-xl overflow-hidden">
        <div className="bg-bg p-8">
          <div className="text-xs uppercase tracking-widest text-subtle">Collected</div>
          <ul className="mt-5 divide-y divide-border">
            {COLLECTED.map((c) => (
              <li key={c.what} className="py-4">
                <div className="font-serif text-base">{c.what}</div>
                <div className="mt-1 text-sm text-muted">{c.why}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-bg p-8">
          <div className="text-xs uppercase tracking-widest text-subtle">Never collected</div>
          <ul className="mt-5 space-y-3">
            {NOT_COLLECTED.map((n) => (
              <li key={n} className="flex gap-3 text-pretty">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-accent flex-shrink-0" />
                <span className="text-muted">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-12 max-w-readable text-sm text-muted">
        Disable telemetry on a Local install by setting <code>KAIROS_TELEMETRY=0</code>. On Cloud,
        admins can opt out for the whole tenant in <code>Settings → Telemetry</code>.
      </div>
      <p className="mt-3 text-xs text-subtle">
        v0.1 · Last updated 2026-04-25 · Counsel review in progress; the collection list above is
        stable and matches what the daemon emits today.
      </p>
    </PageShell>
  )
}
