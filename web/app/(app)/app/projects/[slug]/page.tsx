import { redirect } from 'next/navigation'

export default async function ProjectIndex({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(`/app/projects/${slug}/overview`)
}
