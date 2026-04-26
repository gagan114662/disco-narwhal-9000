'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TOP_TABS, type Project } from '@/lib/app-data'
import { cn } from '@/lib/cn'
import { ProjectSwitcher } from './project-switcher'
import { ThemeToggle } from '../theme-toggle'

type Props = {
  project: Project
  projects: Project[]
}

export function TopNav({ project, projects }: Props) {
  const pathname = usePathname() ?? ''
  const base = `/app/projects/${project.slug}`

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur-md">
      <div className="flex h-12 items-center justify-between gap-4 px-3 md:px-5">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-2 flex-shrink-0">
            <Logomark />
            <span className="font-serif text-sm tracking-tight">kairos-sf</span>
          </Link>
          <span className="text-subtle">/</span>
          <ProjectSwitcher current={project} projects={projects} />
        </div>

        <nav aria-label="Modules" className="hidden md:flex items-center gap-1 flex-1 justify-center min-w-0 overflow-x-auto">
          {TOP_TABS.map((tab) => {
            const href = `${base}/${tab.slug}`
            const active = pathname.startsWith(href)
            return (
              <Link
                key={tab.slug}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium tracking-wide transition-colors',
                  active
                    ? 'bg-surface text-fg'
                    : 'text-muted hover:text-fg hover:bg-surface/60',
                )}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/docs"
            className="hidden sm:inline-flex text-xs text-muted hover:text-fg transition-colors px-2 py-1.5"
          >
            Docs
          </Link>
          <button
            type="button"
            className="hidden sm:inline-flex text-xs text-muted hover:text-fg transition-colors px-2 py-1.5"
            disabled
          >
            Share
          </button>
          <ThemeToggle className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted hover:text-fg hover:bg-surface transition-colors" />
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-[10px] font-mono text-fg">
            GA
          </span>
        </div>
      </div>

      {/* Mobile: tabs scroll horizontally below the bar */}
      <nav aria-label="Modules (mobile)" className="md:hidden flex items-center gap-1 px-3 pb-2 overflow-x-auto">
        {TOP_TABS.map((tab) => {
          const href = `${base}/${tab.slug}`
          const active = pathname.startsWith(href)
          return (
            <Link
              key={tab.slug}
              href={href}
              className={cn(
                'flex-shrink-0 px-3 py-1.5 rounded-md text-xs transition-colors',
                active ? 'bg-surface text-fg' : 'text-muted hover:text-fg hover:bg-surface/60',
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}

function Logomark() {
  return (
    <svg width="18" height="18" viewBox="0 0 22 22" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="10" stroke="currentColor" strokeWidth="1.25" />
      <path d="M6 11h10M11 6v10" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}
