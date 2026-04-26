import type { Metadata } from 'next'
import { PageShell } from '@/components/page-shell'

export const metadata: Metadata = {
  title: 'Product',
  description:
    'Six product surfaces around one artifact: the audit chain. Spec editor, two-key build, audit drilldown, reconciliation, quality dashboard, distribution.',
}

const SURFACES = [
  {
    name: 'Spec editor',
    body: 'Multi-author editing on the spec, with clause anchors and a structured clarification widget. Every confirmed clause produces an eval case before any code is written.',
    artifacts: ['spec.md', 'evals/<spec-id>/*.json', 'clarifications.json'],
  },
  {
    name: 'Two-key build',
    body: 'Builder and reviewer run in parallel. The reviewer emits a per-clause verdict; disagreements gate the workflow with structured questions, not raw diffs.',
    artifacts: ['reviewer/verdict.json', 'audit/events.jsonl', 'app/**/*.ts'],
  },
  {
    name: 'Audit drilldown',
    body: 'Every workflow step, tool call, model call, and gate decision is an audit event with prompt hash, model id, and cost. Append-only today; PII tombstoning and Merkle anchoring land at GA.',
    artifacts: ['audit/events.jsonl', 'merkle-root.txt', 'audit-pack.tar.gz'],
  },
  {
    name: 'Reconciliation',
    body: 'Edit a spec — proposed code diff. Edit code in your editor — proposed spec delta. Both flow through the same gated review queue.',
    artifacts: ['reconciler/proposals/*.json', 'diff/spec-delta.patch'],
  },
  {
    name: 'Quality dashboard',
    body: 'Eval-score-per-archetype trends. Reviewer disagreement rates. Backtest-gated prompt patches. Compounding intelligence you can see, not assert.',
    artifacts: ['quality/<archetype>/score.json', 'patches/proposed.diff'],
  },
  {
    name: 'Distribution',
    body: 'Single binary. Helm chart. docker-compose. VS Code extension. GitHub App so generated code lands as a PR in your repo. Branch protection and CODEOWNERS respected.',
    artifacts: ['kairos.tar.gz', 'helm/kairos-*.tgz', 'github-app/manifest.json'],
  },
]

export default function ProductPage() {
  return (
    <PageShell
      eyebrow="Product"
      title="Six surfaces. One audit chain."
      lede="The platform is a small set of surfaces around a single artifact: the audit chain. Every surface either produces it, gates on it, or hands it to someone else."
    >
      <div className="grid md:grid-cols-2 gap-px bg-border border border-border rounded-xl overflow-hidden">
        {SURFACES.map((s) => (
          <div key={s.name} className="bg-bg p-8 md:p-10">
            <div className="font-serif text-2xl tracking-tight">{s.name}</div>
            <p className="mt-3 text-muted text-pretty max-w-readable">{s.body}</p>
            <div className="mt-6">
              <div className="text-xs uppercase tracking-widest text-subtle">Artifacts</div>
              <ul className="mt-2 font-mono text-[12px] text-muted space-y-1">
                {s.artifacts.map((a) => (
                  <li key={a}>· {a}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  )
}
