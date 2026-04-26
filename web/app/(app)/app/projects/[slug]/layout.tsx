import { notFound } from 'next/navigation'
import { TopNav } from '@/components/app/top-nav'
import { ProjectNav } from '@/components/app/project-nav'
import { PROJECT, PROJECTS } from '@/lib/app-data'

export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ slug: string }>
  children: React.ReactNode
}) {
  const { slug } = await params
  if (slug !== PROJECT.slug) notFound()

  return (
    <div className="flex flex-col min-h-screen">
      <TopNav project={PROJECT} projects={PROJECTS} />
      <div className="flex flex-1 min-h-0">
        <aside className="hidden lg:flex w-56 flex-shrink-0 border-r border-border">
          <ProjectNav projectSlug={PROJECT.slug} />
        </aside>
        <div className="flex flex-1 min-w-0 min-h-0">{children}</div>
      </div>
    </div>
  )
}
