import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Props = {
  title: string
  body?: string
  action?: ReactNode
  variant?: 'default' | 'inline'
  className?: string
}

export function EmptyState({ title, body, action, variant = 'default', className }: Props) {
  return (
    <div
      className={cn(
        'rounded-lg border border-dashed border-border text-center',
        variant === 'default' ? 'p-8 md:p-10' : 'p-5',
        className,
      )}
    >
      <div className={cn('font-serif tracking-tight', variant === 'default' ? 'text-lg' : 'text-base')}>
        {title}
      </div>
      {body && (
        <p className="mt-2 text-sm text-muted text-pretty max-w-prose mx-auto">{body}</p>
      )}
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  )
}
