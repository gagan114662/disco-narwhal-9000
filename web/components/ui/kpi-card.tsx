import Link from 'next/link'
import type { KpiSummary } from '@/lib/app-data'

export function KpiCard({ kpi }: { kpi: KpiSummary }) {
  const trendArrow = kpi.trend?.direction === 'up' ? '↑' : kpi.trend?.direction === 'down' ? '↓' : '→'
  return (
    <Link
      href={kpi.href}
      className="group flex flex-col rounded-lg border border-border bg-bg p-5 hover:bg-surface/40 transition-colors"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[10px] uppercase tracking-widest text-subtle">{kpi.label}</div>
        <span className="text-xs text-subtle group-hover:text-fg transition-colors">→</span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <div className="font-serif text-3xl tracking-tight">{kpi.value}</div>
        {kpi.trend && (
          <div className="font-mono text-[11px] text-muted">
            {trendArrow} {kpi.trend.delta}
          </div>
        )}
      </div>
      <div className="mt-2 text-xs text-muted text-pretty">{kpi.hint}</div>
    </Link>
  )
}
