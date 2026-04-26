'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LEFT_NAV } from '@/lib/app-data'
import { cn } from '@/lib/cn'

type Props = {
  projectSlug: string
}

export function ProjectNav({ projectSlug }: Props) {
  const pathname = usePathname() ?? ''
  const base = `/app/projects/${projectSlug}`

  return (
    <nav aria-label="Project" className="flex flex-col py-3">
      <div className="px-4 pb-2 text-[10px] uppercase tracking-widest text-subtle">
        Project
      </div>
      {LEFT_NAV.map((item) => {
        const href = `${base}/${item.slug}`
        // Highlight Overview when at the project root or any /overview path
        const active =
          item.slug === 'overview'
            ? pathname === base || pathname.startsWith(`${base}/overview`)
            : pathname.startsWith(href)
        return (
          <Link
            key={item.slug}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 px-4 py-2 text-sm border-l-2 transition-colors',
              active
                ? 'border-accent bg-surface text-fg'
                : 'border-transparent text-muted hover:text-fg hover:bg-surface/50',
            )}
          >
            <span className="font-mono text-[10px] text-subtle w-3 flex-shrink-0">·</span>
            <span>{item.label}</span>
          </Link>
        )
      })}

      <div className="mt-6 px-4 pb-2 text-[10px] uppercase tracking-widest text-subtle">
        Workspace
      </div>
      <div className="px-4 pb-3 text-xs text-muted leading-relaxed">
        Local-only preview. Multi-project workspaces land with M3.
      </div>
    </nav>
  )
}
