// Mock indexed-codebase tree with proof-coverage annotations.
// Tree is built from a flat list so coverage hints can be edited in one place.

export type FileAnnotation = 'spec' | 'proof' | 'tests' | 'bare' | 'stale'

export type FileNode = {
  path: string
  size: number
  /** Symbol counts for the symbol list (mocked). */
  symbols: number
  annotations: FileAnnotation[]
  obligationIds: string[]
}

export const FILES: FileNode[] = [
  {
    path: 'routes/vendors.ts',
    size: 2148,
    symbols: 7,
    annotations: ['spec', 'proof', 'tests'],
    obligationIds: ['OB-001', 'OB-005'],
  },
  {
    path: 'routes/approvals.ts',
    size: 1844,
    symbols: 5,
    annotations: ['spec', 'proof', 'tests'],
    obligationIds: ['OB-002', 'OB-003', 'OB-004'],
  },
  {
    path: 'schemas/vendor.ts',
    size: 612,
    symbols: 3,
    annotations: ['spec', 'tests'],
    obligationIds: ['OB-001'],
  },
  {
    path: 'audit/recorder.ts',
    size: 980,
    symbols: 4,
    annotations: ['spec', 'proof'],
    obligationIds: ['OB-004', 'OB-007'],
  },
  {
    path: 'audit/writer.ts',
    size: 410,
    symbols: 2,
    annotations: ['bare'],
    obligationIds: [],
  },
  {
    path: 'lib/compliance.ts',
    size: 0,
    symbols: 0,
    annotations: ['spec'],
    obligationIds: ['OB-005'],
  },
  {
    path: 'lib/session.ts',
    size: 720,
    symbols: 4,
    annotations: ['stale'],
    obligationIds: ['OB-006'],
  },
  {
    path: 'lib/db.ts',
    size: 1340,
    symbols: 6,
    annotations: ['bare'],
    obligationIds: [],
  },
  {
    path: 'tests/vendors.create.test.ts',
    size: 1100,
    symbols: 12,
    annotations: ['tests'],
    obligationIds: ['OB-001'],
  },
  {
    path: 'tests/approvals.session.test.ts',
    size: 870,
    symbols: 9,
    annotations: ['tests'],
    obligationIds: ['OB-002'],
  },
  {
    path: 'tests/approvals.role.test.ts',
    size: 540,
    symbols: 6,
    annotations: ['tests'],
    obligationIds: ['OB-003'],
  },
  {
    path: 'tests/audit.approve.test.ts',
    size: 760,
    symbols: 7,
    annotations: ['tests'],
    obligationIds: ['OB-004'],
  },
  {
    path: 'tests/session.fresh.test.ts',
    size: 480,
    symbols: 4,
    annotations: ['stale', 'tests'],
    obligationIds: ['OB-006'],
  },
  {
    path: 'specs/FR-001.md',
    size: 920,
    symbols: 0,
    annotations: ['spec'],
    obligationIds: ['OB-001'],
  },
  {
    path: 'specs/policies/pii-tombstone.md',
    size: 1140,
    symbols: 0,
    annotations: ['spec'],
    obligationIds: ['OB-007'],
  },
]

export type DirNode = {
  kind: 'dir'
  name: string
  path: string
  children: TreeNode[]
}
export type FileLeaf = { kind: 'file'; name: string; node: FileNode }
export type TreeNode = DirNode | FileLeaf

export function buildTree(files: FileNode[] = FILES): DirNode {
  const root: DirNode = { kind: 'dir', name: '', path: '', children: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let cursor: DirNode = root
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!
      const dirPath = parts.slice(0, i + 1).join('/')
      let next = cursor.children.find(
        (c): c is DirNode => c.kind === 'dir' && c.name === part,
      )
      if (!next) {
        next = { kind: 'dir', name: part, path: dirPath, children: [] }
        cursor.children.push(next)
      }
      cursor = next
    }
    const leaf: FileLeaf = { kind: 'file', name: parts[parts.length - 1]!, node: f }
    cursor.children.push(leaf)
  }
  sortDir(root)
  return root
}

function sortDir(d: DirNode): void {
  d.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const c of d.children) if (c.kind === 'dir') sortDir(c)
}

export function annotationCounts(files: FileNode[] = FILES): Record<FileAnnotation, number> {
  const acc: Record<FileAnnotation, number> = {
    spec: 0,
    proof: 0,
    tests: 0,
    bare: 0,
    stale: 0,
  }
  for (const f of files) for (const a of f.annotations) acc[a] += 1
  return acc
}

/** "Unspec'd public APIs" mock heuristic — bare files in routes/ or lib/. */
export function isUnspecdPublicApi(f: FileNode): boolean {
  return (
    f.annotations.includes('bare') &&
    (f.path.startsWith('routes/') || f.path.startsWith('lib/'))
  )
}

export function applyFilter(files: FileNode[], filter: CodebaseFilter): FileNode[] {
  switch (filter) {
    case 'all':
      return files
    case 'unspecd':
      return files.filter(isUnspecdPublicApi)
    case 'stale':
      return files.filter((f) => f.annotations.includes('stale'))
    case 'bare':
      return files.filter((f) => f.annotations.includes('bare'))
    case 'covered':
      return files.filter((f) => f.annotations.includes('tests'))
  }
}

export type CodebaseFilter = 'all' | 'unspecd' | 'stale' | 'bare' | 'covered'

export const FILTER_LABEL: Record<CodebaseFilter, { label: string; hint?: string }> = {
  all: { label: 'All files' },
  unspecd: { label: 'Unspec’d public APIs', hint: 'bare files in routes/ or lib/' },
  stale: { label: 'Stale proofs', hint: 'last evidence > 7 days' },
  bare: { label: 'Bare (no annotations)', hint: 'no spec, no test, no proof' },
  covered: { label: 'Test-covered', hint: 'has at least one test' },
}
