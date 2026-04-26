import type { Metadata } from 'next'
import { ThreePane } from '@/components/app/three-pane'
import { AgentRail } from '@/components/app/agent-rail'
import { StatusPill } from '@/components/ui/status-pill'
import Link from 'next/link'
import { OBLIGATIONS, PROJECT, type ObligationKind, type ProofStatus } from '@/lib/app-data'
import { ReVerifyButton } from '@/components/app/re-verify-button'

export const metadata: Metadata = {
  title: 'Proofs',
  description:
    'Obligations checklist with status pills, evidence counts, tags, and re-verify entry points.',
}

const KIND_LABEL: Record<ObligationKind, string> = {
  safety: 'Safety',
  security: 'Security',
  compliance: 'Compliance',
  functional: 'Functional',
}

const STATUS_ORDER: ProofStatus[] = ['unproven', 'partial', 'stale', 'discharged']

export default function ProofsPage() {
  const counts = OBLIGATIONS.reduce<Record<ProofStatus, number>>(
    (acc, ob) => {
      acc[ob.status] = (acc[ob.status] ?? 0) + 1
      return acc
    },
    { unproven: 0, partial: 0, discharged: 0, stale: 0 },
  )

  return (
    <ThreePane
      id="proofs"
      left={
        <div className="flex flex-col py-3">
          <div className="px-4 pb-2 text-[10px] uppercase tracking-widest text-subtle">
            Status
          </div>
          <ul className="px-4 space-y-1.5 text-xs">
            {STATUS_ORDER.map((s) => (
              <li key={s} className="flex items-center justify-between gap-2">
                <StatusPill kind={s} />
                <span className="font-mono text-muted">{counts[s] ?? 0}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 px-4 pb-2 text-[10px] uppercase tracking-widest text-subtle">
            Kind
          </div>
          <ul className="px-4 space-y-1 text-xs text-muted">
            {(Object.keys(KIND_LABEL) as ObligationKind[]).map((k) => (
              <li key={k} className="flex items-center justify-between">
                <span>{KIND_LABEL[k]}</span>
                <span className="font-mono">
                  {OBLIGATIONS.filter((o) => o.kind === k).length}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-6 px-4 text-[11px] text-subtle leading-relaxed">
            Industry packs (HIPAA / SOC2 / PCI) and counterexample drilldowns ship next batch.
          </p>
        </div>
      }
      center={
        <div className="px-5 md:px-8 py-6 md:py-8">
          <header className="mb-6 flex items-baseline justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-subtle">Proofs</div>
              <h1 className="font-serif text-2xl tracking-tight mt-1.5">
                Obligations &amp; evidence
              </h1>
              <p className="mt-1 text-sm text-muted">
                {OBLIGATIONS.length} obligation{OBLIGATIONS.length === 1 ? '' : 's'} ·{' '}
                {OBLIGATIONS.reduce((sum, o) => sum + o.evidenceCount, 0)} evidence items
              </p>
            </div>
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-surface transition-colors disabled:opacity-50"
            >
              Re-verify all (M3)
            </button>
          </header>

          <ul className="space-y-3">
            {OBLIGATIONS.map((ob) => (
              <li
                key={ob.id}
                className="rounded-lg border border-border bg-bg hover:bg-surface/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-4 p-4">
                  <Link
                    href={`/app/projects/${PROJECT.slug}/proofs/${ob.id}`}
                    className="min-w-0 flex-1 group"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-subtle">{ob.id}</span>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
                        {KIND_LABEL[ob.kind]}
                      </span>
                    </div>
                    <h3 className="mt-1 font-serif text-base tracking-tight text-fg text-balance group-hover:underline underline-offset-4">
                      {ob.title}
                    </h3>
                    <p className="mt-1.5 text-sm text-muted text-pretty max-w-prose">
                      {ob.description}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-subtle">
                      <span>
                        evidence{' '}
                        <span className="text-fg">{ob.evidenceCount}</span>
                      </span>
                      <span>
                        work orders{' '}
                        <span className="text-fg">
                          {ob.workOrderIds.length === 0 ? '—' : ob.workOrderIds.join(', ')}
                        </span>
                      </span>
                      {ob.tags.length > 0 && (
                        <span>
                          tags <span className="text-fg">{ob.tags.join(', ')}</span>
                        </span>
                      )}
                    </div>
                  </Link>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <StatusPill kind={ob.status} />
                    <ReVerifyButton current={ob.status} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      }
      right={
        <AgentRail
          title="Proof agent"
          banner={{
            tone: 'warn',
            text: 'OB-005 is unproven. Generate eval cases or attach existing tests?',
          }}
          pinned={OBLIGATIONS.filter((o) => o.status !== 'discharged').slice(0, 3).map((o) => ({
            id: o.id,
            kind: 'obligation' as const,
            label: o.title,
          }))}
          chips={['Re-verify proof', 'Open counterexample', 'Generate eval', 'Attach evidence', 'Explain obligation']}
        />
      }
    />
  )
}
