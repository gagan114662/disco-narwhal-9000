import type { Metadata } from 'next'
import { ModuleStub } from '@/components/app/module-stub'
import { INDEXING } from '@/lib/app-data'

export const metadata: Metadata = {
  title: 'Codebase',
  description: 'File tree + symbol list with annotation badges (Spec / Proof / Tests / Bare).',
}

export default function CodebasePage() {
  return (
    <ModuleStub
      paneId="codebase"
      module="Project · Codebase"
      title="The repo, indexed and annotated."
      description={`Indexed against ${INDEXING.repo}@${INDEXING.branch}. ${INDEXING.files} files, ${INDEXING.symbols} symbols. The annotated tree, symbol list, and filter chips ("unspec'd public APIs", "stale proofs") land next batch.`}
      leftTreeTitle="Filters"
      leftTreeItems={[
        { id: 'ALL', label: 'All files', hint: `${INDEXING.files} files` },
        { id: 'UNS', label: 'Unspec’d public APIs', hint: 'next batch' },
        { id: 'STA', label: 'Stale proofs', hint: 'next batch' },
        { id: 'BAR', label: 'Bare (no annotations)', hint: 'next batch' },
        { id: 'COV', label: 'Test-covered', hint: 'next batch' },
      ]}
      centerNote="Annotated file tree + symbol list lands next batch."
    />
  )
}
