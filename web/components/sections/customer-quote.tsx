// Drop a real customer quote in here when you have one.
// Format intentionally puts title + company first; person's name last.
// To use: add <CustomerQuote /> to app/(marketing)/page.tsx between <Hero /> and <Problem />.

type Props = {
  title: string
  company: string
  quote: string
  name: string
  logoUrl?: string
}

export function CustomerQuote({ title, company, quote, name, logoUrl }: Props) {
  return (
    <section className="border-y border-border bg-surface/30">
      <div className="container py-16 md:py-20">
        <div className="grid md:grid-cols-12 gap-10 items-center">
          <div className="md:col-span-3">
            <div className="text-xs uppercase tracking-[0.18em] text-muted">{title}</div>
            <div className="mt-2 font-serif text-xl tracking-tight">{company}</div>
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={`${company} logo`}
                className="mt-4 h-6 w-auto opacity-70"
              />
            )}
          </div>
          <blockquote className="md:col-span-9">
            <p className="font-serif text-2xl md:text-3xl tracking-tight text-balance leading-snug">
              “{quote}”
            </p>
            <footer className="mt-5 text-sm text-muted">— {name}</footer>
          </blockquote>
        </div>
      </div>
    </section>
  )
}
