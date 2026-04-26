import Link from 'next/link'
import { AppHeader } from '@/components/app/app-header'
import { PROJECTS } from '@/lib/stub-data'

export default function ProjectsPage() {
  return (
    <>
      <AppHeader crumbs={[{ label: 'projects' }]} />
      <main className="flex-1 px-6 py-10 md:px-10 md:py-12">
        <div className="max-w-5xl mx-auto">
          <div className="text-[10px] uppercase tracking-widest text-subtle">Projects</div>
          <h1 className="font-serif text-3xl tracking-tight mt-2">All projects</h1>
          <p className="mt-3 text-sm text-muted max-w-readable">
            Each project is a typed pipeline of artifacts. Pick one to enter its spec, build,
            audit, reconcile, and quality stages.
          </p>

          <ul className="mt-10 divide-y divide-border border-y border-border">
            {PROJECTS.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/app/projects/${p.slug}/overview`}
                  className="grid md:grid-cols-12 gap-4 py-6 hover:bg-surface/50 transition-colors px-2"
                >
                  <div className="md:col-span-4">
                    <div className="font-serif text-lg tracking-tight">{p.name}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-subtle">{p.slug}</div>
                  </div>
                  <div className="md:col-span-5 text-sm text-muted text-pretty">{p.description}</div>
                  <div className="md:col-span-3 md:text-right">
                    <div className="text-[10px] uppercase tracking-widest text-subtle">Last build</div>
                    <div className="mt-0.5 font-mono text-xs text-fg">{p.lastBuildId}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-10 text-xs text-subtle">
            One project ships in the preview. Multi-project tenancy lands with M3.
          </p>
        </div>
      </main>
    </>
  )
}
