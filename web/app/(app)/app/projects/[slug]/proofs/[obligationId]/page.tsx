import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ThreePane } from '@/components/app/three-pane'
import { AgentRail } from '@/components/app/agent-rail'
import { ObligationCard } from '@/components/app/obligation-card'
import {
  OBLIGATIONS,
  PROJECT,
  findObligation,
  type ProofStatus,
} from '@/lib/app-data'
import { StatusPill } from '@/components/ui/status-pill'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ obligationId: string }>
}): Promise<Metadata> {
  const { obligationId } = await params
  const ob = findObligation(obligationId)
  if (!ob) return { title: 'Obligation not found' }
  return {
    title: `${ob.id} · ${ob.title}`,
    description: ob.description,
  }
}

const STATUS_ORDER: ProofStatus[] = ['unproven', 'partial', 'stale', 'discharged']

export default async function ObligationDetailPage({
  params,
}: {
  params: Promise<{ slug: string; obligationId: string }>
}) {
  const { slug, obligationId } = await params
  if (slug !== PROJECT.slug) notFound()
  const ob = findObligation(obligationId)
  if (!ob) notFound()

  const idx = OBLIGATIONS.findIndex((o) => o.id === ob.id)
  const prev = idx > 0 ? OBLIGATIONS[idx - 1] : null
  const next = idx < OBLIGATIONS.length - 1 ? OBLIGATIONS[idx + 1] : null

  return (
    <ThreePane
      id="proofs-detail"
      left={
        <div className="flex flex-col py-3">
          <div className="px-4 pb-2 text-[10px] uppercase tracking-widest text-subtle">
            Obligations
          </div>
          <ul>
            {STATUS_ORDER.flatMap((status) =>
              OBLIGATIONS.filter((o) => o.status === status).map((o) => {
                const active = o.id === ob.id
                return (
                  <li key={o.id}>
                    <Link
                      href={`/app/projects/${PROJECT.slug}/proofs/${o.id}`}
                      className={`flex items-start gap-3 px-4 py-2.5 text-sm border-l-2 transition-colors ${
                        active
                          ? 'border-accent bg-surface text-fg'
                          : 'border-transparent text-muted hover:text-fg hover:bg-surface/40'
                      }`}
                    >
                      <span className="font-mono text-[10px] text-subtle pt-0.5 w-12 flex-shrink-0">
                        {o.id}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-fg truncate text-[13px]">{o.title}</span>
                        <span className="mt-0.5 inline-block">
                          <StatusPill kind={o.status} />
                        </span>
                      </span>
                    </Link>
                  </li>
                )
              }),
            )}
          </ul>
        </div>
      }
      center={
        <div className="px-5 md:px-8 py-6 md:py-8 max-w-4xl">
          <div className="mb-4 flex items-center gap-3 text-[11px] font-mono text-subtle">
            <Link
              href={`/app/projects/${PROJECT.slug}/proofs`}
              className="hover:text-fg transition-colors"
            >
              ← All obligations
            </Link>
          </div>

          <ObligationCard obligation={ob} />

          <nav className="mt-6 grid md:grid-cols-2 gap-px bg-border border border-border rounded-lg overflow-hidden">
            <NavCell
              label="Previous"
              href={prev ? `/app/projects/${PROJECT.slug}/proofs/${prev.id}` : null}
              value={prev ? `${prev.id} · ${prev.title}` : '—'}
            />
            <NavCell
              label="Next"
              href={next ? `/app/projects/${PROJECT.slug}/proofs/${next.id}` : null}
              value={next ? `${next.id} · ${next.title}` : '—'}
            />
          </nav>
        </div>
      }
      right={
        <AgentRail
          title="Proof agent"
          banner={
            ob.status === 'discharged'
              ? null
              : ob.status === 'stale'
                ? { tone: 'warn', text: 'Last evidence is older than 7 days. Re-verify recommended.' }
                : ob.status === 'unproven'
                  ? { tone: 'warn', text: 'No evidence attached yet. Add tests or accept reviewer verdicts.' }
                  : { tone: 'info', text: 'Counterexample detected. Generate a covering test or fix the handler?' }
          }
          pinned={[
            { id: ob.id, kind: 'obligation', label: ob.title },
            ...ob.workOrderIds.slice(0, 2).map((id) => ({
              id,
              kind: 'work-order' as const,
              label: id,
            })),
          ]}
          chips={[
            'Re-verify proof',
            'Generate covering test',
            'Open counterexample',
            'Attach existing test',
            'Explain rationale',
          ]}
        />
      }
    />
  )
}

function NavCell({
  label,
  href,
  value,
}: {
  label: string
  href: string | null
  value: string
}) {
  const inner = (
    <div className="bg-bg p-4">
      <div className="text-[10px] uppercase tracking-widest text-subtle">{label}</div>
      <div className="mt-1 font-mono text-xs text-fg truncate">{value}</div>
    </div>
  )
  if (!href) return <div className="opacity-50">{inner}</div>
  return (
    <Link href={href} className="block hover:bg-surface/40 transition-colors">
      {inner}
    </Link>
  )
}
