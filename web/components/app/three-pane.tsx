'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

type Props = {
  /** Stable id for persistence in localStorage. */
  id: string
  left?: React.ReactNode
  center: React.ReactNode
  right?: React.ReactNode
  /** Default widths in px for left and right when present. */
  defaults?: { left?: number; right?: number }
  /** Min widths in px. */
  min?: { left?: number; right?: number }
  /** Max widths in px. */
  max?: { left?: number; right?: number }
}

const STORAGE_PREFIX = 'kairos-three-pane:'

function readWidths(id: string): { left?: number; right?: number } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id)
    return raw ? (JSON.parse(raw) as { left?: number; right?: number }) : null
  } catch {
    return null
  }
}

function writeWidths(id: string, widths: { left?: number; right?: number }): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(widths))
  } catch {
    // ignore
  }
}

export function ThreePane({
  id,
  left,
  center,
  right,
  defaults = { left: 240, right: 320 },
  min = { left: 180, right: 280 },
  max = { left: 520, right: 640 },
}: Props) {
  const hasLeft = Boolean(left)
  const hasRight = Boolean(right)

  const minLeft = min.left ?? 180
  const maxLeft = max.left ?? 520
  const minRight = min.right ?? 280
  const maxRight = max.right ?? 640

  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v))

  const [leftW, setLeftW] = useState<number>(
    clamp(defaults.left ?? 240, minLeft, maxLeft),
  )
  const [rightW, setRightW] = useState<number>(
    clamp(defaults.right ?? 320, minRight, maxRight),
  )
  const [hydrated, setHydrated] = useState(false)
  const draggingRef = useRef<'left' | 'right' | null>(null)

  useEffect(() => {
    const stored = readWidths(id)
    if (stored?.left) setLeftW(clamp(stored.left, minLeft, maxLeft))
    if (stored?.right) setRightW(clamp(stored.right, minRight, maxRight))
    setHydrated(true)
    // Clamp bounds are stable per pane id; not in deps to avoid re-running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (hydrated) writeWidths(id, { left: leftW, right: rightW })
  }, [hydrated, id, leftW, rightW])

  const onMove = useCallback(
    (e: MouseEvent) => {
      const which = draggingRef.current
      if (!which) return
      if (which === 'left') {
        setLeftW(clamp(e.clientX, minLeft, maxLeft))
      } else {
        // right splitter — distance from viewport right edge
        setRightW(clamp(window.innerWidth - e.clientX, minRight, maxRight))
      }
    },
    [maxLeft, maxRight, minLeft, minRight],
  )

  const onUp = useCallback(() => {
    if (draggingRef.current) {
      draggingRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [onMove, onUp])

  function startDrag(which: 'left' | 'right') {
    draggingRef.current = which
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div className="flex flex-1 min-h-0 min-w-0">
      {hasLeft && (
        <>
          <aside
            style={{ width: leftW }}
            className="hidden lg:flex flex-shrink-0 border-r border-border min-w-0 overflow-auto"
          >
            <div className="w-full">{left}</div>
          </aside>
          <Splitter onMouseDown={() => startDrag('left')} />
        </>
      )}
      <section className="flex-1 min-w-0 overflow-auto">{center}</section>
      {hasRight && (
        <>
          <Splitter onMouseDown={() => startDrag('right')} />
          <aside
            style={{ width: rightW }}
            className="hidden xl:flex flex-shrink-0 border-l border-border min-w-0 overflow-auto"
          >
            <div className="w-full">{right}</div>
          </aside>
        </>
      )}
    </div>
  )
}

function Splitter({ onMouseDown }: { onMouseDown: () => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      className={cn(
        'hidden lg:block w-px bg-border hover:bg-accent/40 cursor-col-resize transition-colors',
        'relative before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-[""]',
      )}
    />
  )
}
