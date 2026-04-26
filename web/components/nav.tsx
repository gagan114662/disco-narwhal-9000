'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { ThemeToggle } from './theme-toggle'

const PRIMARY_LINKS = [
  { href: '/product', label: 'Product' },
  { href: '/security', label: 'Security' },
  { href: '/pricing', label: 'Pricing' },
]

const MOBILE_EXTRAS = [
  { href: '/app', label: 'See it run' },
  { href: '/docs', label: 'Docs' },
  { href: '/contact', label: 'Contact' },
  { href: '/signin', label: 'Sign in' },
]

export function Nav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // close menu on route change
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // lock scroll while menu is open
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prev
      }
    }
  }, [open])

  // close on escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header className="sticky top-0 z-40 bg-bg/85 backdrop-blur-md border-b border-border">
      <div className="container flex h-16 items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
          <Logomark />
          <span className="font-serif text-lg tracking-tight">kairos-sf</span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm text-muted">
          {PRIMARY_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-fg transition-colors">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden md:inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted hover:text-fg hover:bg-surface transition-colors" />
          <Link
            href="/start"
            className="hidden sm:inline-flex text-sm bg-fg text-bg px-4 py-2 rounded-full hover:opacity-90 transition-opacity"
          >
            Get started
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-surface transition-colors"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      {/* Mobile slide-down menu */}
      <div
        id="mobile-menu"
        className={cn(
          'md:hidden border-t border-border bg-bg overflow-hidden transition-[max-height] duration-200 ease-out',
          open ? 'max-h-[80vh]' : 'max-h-0',
        )}
      >
        <nav className="container py-4 flex flex-col gap-1">
          {[...PRIMARY_LINKS, ...MOBILE_EXTRAS].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-2 py-3 text-base text-fg hover:bg-surface rounded-md transition-colors"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/start"
            className="mt-3 inline-flex items-center justify-center rounded-full bg-fg text-bg px-4 py-3 text-sm hover:opacity-90 transition-opacity"
          >
            Get started
          </Link>
          <div className="mt-2 flex items-center gap-2 px-2 py-2 text-xs text-muted">
            <span>Theme</span>
            <ThemeToggle />
          </div>
        </nav>
      </div>
    </header>
  )
}

function Logomark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="10" stroke="currentColor" strokeWidth="1.25" />
      <path d="M6 11h10M11 6v10" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2 4h10M2 10h10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}
