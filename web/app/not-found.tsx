import Link from 'next/link'
import { Nav } from '@/components/nav'
import { Footer } from '@/components/footer'

const SUGGESTIONS = [
  { href: '/', label: 'Home' },
  { href: '/product', label: 'Product' },
  { href: '/security', label: 'Security & on-prem' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/app', label: 'See it run' },
  { href: '/docs', label: 'Documentation' },
  { href: '/contact', label: 'Contact' },
]

export const metadata = {
  title: 'Not found',
}

export default function NotFound() {
  return (
    <>
      <Nav />
      <main>
        <section className="container py-24 md:py-32">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.18em] text-muted">404</div>
            <h1 className="display-serif text-display-xl mt-6 text-balance">
              That page doesn’t exist here.
            </h1>
            <p className="mt-6 text-lg text-muted max-w-readable text-pretty">
              You may have followed a link to a page we haven’t built yet, or to one that moved.
              The audit chain isn’t affected — only this URL.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                href="/"
                className="inline-flex items-center gap-2 bg-fg text-bg rounded-full px-5 py-3 text-sm hover:opacity-90 transition-opacity"
              >
                Back to home
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 border border-border rounded-full px-5 py-3 text-sm hover:bg-surface transition-colors"
              >
                Tell us what you were looking for
              </Link>
            </div>
          </div>

          <div className="mt-16 border-t border-border pt-10">
            <div className="text-xs uppercase tracking-widest text-subtle">Try one of these</div>
            <ul className="mt-5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {SUGGESTIONS.map((s) => (
                <li key={s.href}>
                  <Link
                    href={s.href}
                    className="block rounded-lg border border-border px-4 py-3 text-sm hover:bg-surface transition-colors"
                  >
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
