const LINES: Array<{ kind: 'cmd' | 'log' | 'ok' | 'note' | 'warn'; text: string }> = [
  { kind: 'cmd', text: '$ kairos build "vendor onboarding form"' },
  { kind: 'log', text: '· spec captured · 4 clarifying questions' },
  { kind: 'log', text: '· eval pack generated (12 cases)' },
  { kind: 'log', text: '· builder + reviewer started in parallel' },
  { kind: 'warn', text: '· reviewer flagged clause 4 — approval bypass' },
  { kind: 'log', text: '· builder retried with constraint' },
  { kind: 'ok', text: '· evals 12/12 · reviewer agreed · sealed' },
  { kind: 'note', text: '→ http://localhost:7780  ·  build-9c4a2' },
]

const STYLES: Record<(typeof LINES)[number]['kind'], string> = {
  cmd: 'text-fg',
  log: 'text-muted',
  ok: 'text-accent',
  note: 'text-fg',
  warn: 'text-fg',
}

export function DemoConsole() {
  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-[0_1px_0_0_hsl(var(--border)),0_24px_64px_-32px_rgba(0,0,0,0.18)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3 gap-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
        </div>
        <div className="font-mono text-[11px] text-subtle truncate">
          build-9c4a2 · spec → app · 4m 12s
        </div>
        <div className="font-mono text-[11px] text-muted">live</div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr,200px]">
        <pre className="font-mono text-[12px] leading-relaxed p-5 overflow-x-auto whitespace-pre">
          {LINES.map((line, i) => (
            <div key={i} className={STYLES[line.kind]}>
              {line.kind === 'warn' && '! '}
              {line.kind === 'ok' && '✓ '}
              {line.text}
            </div>
          ))}
        </pre>
        <aside className="border-t md:border-t-0 md:border-l border-border p-5 text-sm">
          <div className="text-[10px] uppercase tracking-widest text-subtle">Audit chain</div>
          <ul className="mt-3 space-y-1.5 font-mono text-[11px] text-muted">
            <li>· build_started</li>
            <li>· spec_confirmed</li>
            <li>· evals_generated</li>
            <li>· reviewer_disagreed</li>
            <li>· builder_retried</li>
            <li className="text-accent">· build_sealed ✓</li>
          </ul>
          <div className="mt-4 text-[11px] text-subtle leading-snug">
            Append-only today. Hash-linked, PII-tombstoned, Merkle-anchored at GA.
          </div>
        </aside>
      </div>
    </div>
  )
}
