import type { ReactNode } from 'react'

type Props = {
  eyebrow: string
  title: string
  lede?: string
  children?: ReactNode
}

export function PageShell({ eyebrow, title, lede, children }: Props) {
  return (
    <section className="container py-24 md:py-32">
      <div className="max-w-3xl">
        <div className="text-xs uppercase tracking-[0.18em] text-muted">{eyebrow}</div>
        <h1 className="display-serif text-display-xl mt-6 text-balance">{title}</h1>
        {lede && (
          <p className="mt-6 text-lg text-muted max-w-readable text-pretty">{lede}</p>
        )}
      </div>
      {children && <div className="mt-16">{children}</div>}
    </section>
  )
}
