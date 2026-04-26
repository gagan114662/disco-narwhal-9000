import Link from 'next/link'
import { ConsentLink } from './consent-link'

const columns = [
  {
    title: 'Product',
    links: [
      { href: '/product', label: 'Product' },
      { href: '/app', label: 'See it run' },
      { href: '/security', label: 'Security' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/changelog', label: 'Changelog' },
    ],
  },
  {
    title: 'Trust',
    links: [
      { href: '/status', label: 'Status' },
      { href: '/legal/sub-processors', label: 'Sub-processors' },
      { href: '/security/advisories', label: 'Advisories' },
      { href: '/legal/telemetry', label: 'Telemetry' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/careers', label: 'Careers' },
      { href: '/contact', label: 'Contact' },
      { href: '/press', label: 'Press' },
      { href: '/signin', label: 'Sign in' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '/docs', label: 'Docs' },
      { href: '/blog', label: 'Blog' },
      { href: '/community', label: 'Community' },
      { href: '/research', label: 'Research notes' },
    ],
  },
]

export function Footer() {
  return (
    <footer className="border-t border-border mt-32">
      <div className="container py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
          <div className="col-span-2 md:col-span-1">
            <div className="font-serif text-lg tracking-tight">kairos-sf</div>
            <p className="mt-3 text-sm text-muted max-w-xs">
              Auditable apps from plain-English specs. For teams that have to show their work.
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <div className="text-xs uppercase tracking-widest text-subtle">{col.title}</div>
              <ul className="mt-4 space-y-3 text-sm">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-muted hover:text-fg transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-16 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-t border-border pt-8 text-xs text-subtle">
          <div>© {new Date().getFullYear()} KAIROS-SF, Inc. All rights reserved.</div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/legal/terms">Terms</Link>
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/dpa">DPA</Link>
            <ConsentLink className="text-subtle hover:text-fg transition-colors" />
          </div>
        </div>
      </div>
    </footer>
  )
}
