import { cn } from '@/lib/cn'

export type StatusKind =
  | 'idle'
  | 'pending'
  | 'active'
  | 'discharged'
  | 'partial'
  | 'unproven'
  | 'stale'
  | 'blocked'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'todo'
  | 'failed'
  | 'ready'
  | 'indexing'
  | 'live'
  | 'sealed'

type Props = {
  kind: StatusKind
  children?: React.ReactNode
  className?: string
}

const STYLES: Record<
  StatusKind,
  { dot: string; ring: string; text: string; label: string }
> = {
  idle:        { dot: 'bg-subtle',   ring: 'border-border',           text: 'text-muted',  label: 'idle' },
  pending:     { dot: 'bg-subtle',   ring: 'border-border',           text: 'text-muted',  label: 'pending' },
  active:      { dot: 'bg-accent',   ring: 'border-accent/30 bg-accent/5', text: 'text-accent', label: 'active' },
  discharged:  { dot: 'bg-accent',   ring: 'border-accent/30 bg-accent/5', text: 'text-accent', label: 'discharged' },
  partial:     { dot: 'bg-amber-500',ring: 'border-amber-500/30 bg-amber-500/5', text: 'text-amber-700 dark:text-amber-400', label: 'partial' },
  unproven:    { dot: 'bg-fg/40',    ring: 'border-border',           text: 'text-muted',  label: 'unproven' },
  stale:       { dot: 'bg-fg/40',    ring: 'border-border',           text: 'text-muted',  label: 'stale' },
  blocked:     { dot: 'bg-rose-500', ring: 'border-rose-500/30 bg-rose-500/5', text: 'text-rose-700 dark:text-rose-400', label: 'blocked' },
  in_progress: { dot: 'bg-accent',   ring: 'border-accent/30 bg-accent/5', text: 'text-accent', label: 'in progress' },
  in_review:   { dot: 'bg-amber-500',ring: 'border-amber-500/30 bg-amber-500/5', text: 'text-amber-700 dark:text-amber-400', label: 'in review' },
  done:        { dot: 'bg-accent',   ring: 'border-accent/30 bg-accent/5', text: 'text-accent', label: 'done' },
  todo:        { dot: 'bg-subtle',   ring: 'border-border',           text: 'text-muted',  label: 'todo' },
  failed:      { dot: 'bg-rose-500', ring: 'border-rose-500/30 bg-rose-500/5', text: 'text-rose-700 dark:text-rose-400', label: 'failed' },
  ready:       { dot: 'bg-accent',   ring: 'border-accent/30 bg-accent/5', text: 'text-accent', label: 'ready' },
  indexing:    { dot: 'bg-accent animate-pulse-soft', ring: 'border-accent/30 bg-accent/5', text: 'text-accent', label: 'indexing' },
  live:        { dot: 'bg-accent animate-pulse-soft', ring: 'border-accent/30 bg-accent/5', text: 'text-accent', label: 'live' },
  sealed:      { dot: 'bg-accent',   ring: 'border-accent/30 bg-accent/5', text: 'text-accent', label: 'sealed' },
}

export function StatusPill({ kind, children, className }: Props) {
  const s = STYLES[kind]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-mono',
        s.ring,
        s.text,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {children ?? s.label}
    </span>
  )
}
