import { redirect } from 'next/navigation'
import { PROJECT } from '@/lib/app-data'

export default function AppRoot() {
  redirect(`/app/projects/${PROJECT.slug}/overview`)
}
