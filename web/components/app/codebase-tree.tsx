'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { PROJECT } from '@/lib/app-data'
import {
  FILES,
  FILTER_LABEL,
  annotationCounts,
  applyFilter,
  buildTree,
  type CodebaseFilter,
  type DirNode,
  type FileAnnotation,
  type FileLeaf,
  type FileNode,
  type TreeNode,
} from '@/lib/codebase-data'
import { cn } from '@/lib/cn'

const ANNOTATION_TONE: Record<FileAnnotation, string> = {
  spec: 'border-fg/20 bg-surface text-fg/80',
  proof: 'border-accent/30 bg-accent/10 text-accent',
  tests: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  bare: 'border-border bg-bg text-subtle',
  stale: 'border-fg/30 bg-fg/5 text-fg/70',
}

const ANNOTATION_GLYPH: Record<FileAnnotation, string> = {
  spec: '§',
  proof: '✓',
  tests: '⏵',
  bare: '·',
  stale: '~',
}

type Props = {
  defaultFilter?: CodebaseFilter
}

export function CodebaseTree({ defaultFilter = 'all' }: Props) {
  const [filter, setFilter] = useState<CodebaseFilter>(defaultFilter)
  const [activePath, setActivePath] = useState<string>(FILES[0]?.path ?? '')
  const filteredFiles = useMemo(() => applyFilter(FILES, filter), [filter])
  const tree = useMemo(() => buildTree(filteredFiles), [filteredFiles])
  const counts = useMemo(() => annotationCounts(FILES), [])
  const active = useMemo(
    () => filteredFiles.find((f) => f.path === activePath) ?? filteredFiles[0] ?? null,
    [filteredFiles, activePath],
  )

  return (
    <div className="flex flex-col min-h-0 h-full">
      <header className="flex-shrink-0 border-b border-border px-5 md:px-8 py-4 bg-bg">
        <div className="text-[10px] uppercase tracking-widest text-subtle">Codebase</div>
        <h1 className="mt-1 font-serif text-2xl tracking-tight">Indexed &amp; annotated tree</h1>
        <p className="mt-1.5 text-sm text-muted max-w-prose">
          Each file carries the annotations the indexer derived: spec citations, proof
          obligations, tests, and freshness. Switch filters to scope what you see.
        </p>
        <nav className="mt-4 flex flex-wrap gap-1.5">
          {(Object.keys(FILTER_LABEL) as CodebaseFilter[]).map((id) => {
            const active = filter === id
            const count = applyFilter(FILES, id).length
            return (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                  active
                    ? 'border-fg bg-fg text-bg'
                    : 'border-border text-muted hover:text-fg hover:bg-surface',
                )}
                title={FILTER_LABEL[id].hint}
              >
                {FILTER_LABEL[id].label}
                <span
                  className={cn(
                    'font-mono text-[10px]',
                    active ? 'text-bg/70' : 'text-subtle',
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </nav>
      </header>

      <div className="flex-1 grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(280px,360px),minmax(0,1fr)]">
        <aside className="border-b lg:border-b-0 lg:border-r border-border min-h-0 overflow-auto">
          {filteredFiles.length === 0 ? (
            <div className="px-4 py-6 text-xs text-subtle">No files match this filter.</div>
          ) : (
            <Tree
              node={tree}
              activePath={activePath}
              onSelect={setActivePath}
              depth={0}
            />
          )}
        </aside>
        <section className="min-h-0 overflow-auto px-5 md:px-8 py-6 max-w-3xl">
          {active ? (
            <FileDetail file={active} counts={counts} />
          ) : (
            <div className="text-sm text-muted">Select a file from the tree.</div>
          )}
        </section>
      </div>
    </div>
  )
}

function Tree({
  node,
  activePath,
  onSelect,
  depth,
}: {
  node: DirNode
  activePath: string
  onSelect: (path: string) => void
  depth: number
}) {
  return (
    <ul>
      {node.children.map((c) =>
        c.kind === 'dir' ? (
          <DirRow
            key={`d-${c.path}`}
            dir={c}
            activePath={activePath}
            onSelect={onSelect}
            depth={depth}
          />
        ) : (
          <FileRow
            key={`f-${c.node.path}`}
            leaf={c}
            active={c.node.path === activePath}
            onSelect={onSelect}
            depth={depth}
          />
        ),
      )}
    </ul>
  )
}

function DirRow({
  dir,
  activePath,
  onSelect,
  depth,
}: {
  dir: DirNode
  activePath: string
  onSelect: (path: string) => void
  depth: number
}) {
  const [open, setOpen] = useState(true)
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 px-3 py-1 text-left hover:bg-surface/40 transition-colors"
        style={{ paddingLeft: 12 + depth * 14 }}
      >
        <span aria-hidden className="font-mono text-[10px] text-subtle w-3">
          {open ? '▾' : '▸'}
        </span>
        <span className="font-mono text-[12px] text-fg/80">{dir.name}/</span>
      </button>
      {open && (
        <Tree node={dir} activePath={activePath} onSelect={onSelect} depth={depth + 1} />
      )}
    </li>
  )
}

function FileRow({
  leaf,
  active,
  onSelect,
  depth,
}: {
  leaf: FileLeaf
  active: boolean
  onSelect: (path: string) => void
  depth: number
}) {
  const f = leaf.node
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(f.path)}
        className={cn(
          'w-full flex items-center justify-between gap-2 px-3 py-1 text-left transition-colors border-l-2',
          active
            ? 'border-accent bg-surface'
            : 'border-transparent hover:bg-surface/40',
        )}
        style={{ paddingLeft: 12 + depth * 14 }}
      >
        <span className="min-w-0 flex items-center gap-1.5">
          <span aria-hidden className="font-mono text-[10px] text-subtle w-3">
            ·
          </span>
          <span className="font-mono text-[12px] text-fg truncate">{leaf.name}</span>
        </span>
        <span className="flex items-center gap-0.5 flex-shrink-0">
          {f.annotations.map((a) => (
            <AnnotationBadge key={a} annotation={a} compact />
          ))}
        </span>
      </button>
    </li>
  )
}

function AnnotationBadge({
  annotation,
  compact = false,
}: {
  annotation: FileAnnotation
  compact?: boolean
}) {
  return (
    <span
      title={annotation}
      className={cn(
        'inline-flex items-center justify-center rounded border font-mono',
        compact ? 'h-4 w-4 text-[9px]' : 'h-5 px-1.5 text-[10px] gap-1',
        ANNOTATION_TONE[annotation],
      )}
    >
      <span aria-hidden>{ANNOTATION_GLYPH[annotation]}</span>
      {!compact && <span>{annotation}</span>}
    </span>
  )
}

function FileDetail({
  file,
  counts,
}: {
  file: FileNode
  counts: Record<FileAnnotation, number>
}) {
  return (
    <article>
      <header>
        <div className="text-[10px] uppercase tracking-widest text-subtle">File</div>
        <h2 className="mt-1 font-mono text-base text-fg">{file.path}</h2>
        <div className="mt-1.5 font-mono text-[11px] text-subtle flex flex-wrap gap-3">
          <span>
            {file.size === 0 ? 'empty' : `${file.size} bytes`}
          </span>
          <span>{file.symbols} symbols</span>
        </div>
      </header>

      <section className="mt-5">
        <div className="text-[10px] uppercase tracking-widest text-subtle">Annotations</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {file.annotations.length === 0 ? (
            <span className="text-[11px] font-mono text-subtle">—</span>
          ) : (
            file.annotations.map((a) => <AnnotationBadge key={a} annotation={a} />)
          )}
        </div>
      </section>

      <section className="mt-5">
        <div className="text-[10px] uppercase tracking-widest text-subtle">Obligations</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {file.obligationIds.length === 0 ? (
            <span className="text-[11px] font-mono text-subtle">—</span>
          ) : (
            file.obligationIds.map((id) => (
              <Link
                key={id}
                href={`/app/projects/${PROJECT.slug}/proofs/${id}`}
                className="rounded-full border border-border px-2 py-0.5 text-[10px] font-mono text-muted hover:text-fg hover:bg-surface transition-colors"
              >
                {id}
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="mt-8 border-t border-border pt-5">
        <div className="text-[10px] uppercase tracking-widest text-subtle">Project totals</div>
        <ul className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2">
          {(Object.keys(counts) as FileAnnotation[]).map((a) => (
            <li
              key={a}
              className="rounded-md border border-border bg-bg px-2.5 py-2"
            >
              <div className="flex items-center gap-1.5">
                <AnnotationBadge annotation={a} compact />
                <span className="font-mono text-[11px] text-fg">{counts[a]}</span>
              </div>
              <div className="mt-1 text-[10px] text-subtle">{a}</div>
            </li>
          ))}
        </ul>
      </section>
    </article>
  )
}
