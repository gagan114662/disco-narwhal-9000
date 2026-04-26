'use client'

import { useEffect, useRef, useState } from 'react'
import type { ProofStatus } from '@/lib/app-data'
import { cn } from '@/lib/cn'

type Outcome = {
  status: ProofStatus
  detail: string
  durationMs: number
}

type Props = {
  /** Initial proof status — drives the simulated outcome on click. */
  current: ProofStatus
  /** Optional override for the simulated outcome. Defaults to a stable pseudo-result. */
  outcome?: Outcome
  size?: 'sm' | 'md'
  className?: string
}

const DEFAULTS: Record<ProofStatus, Outcome> = {
  discharged: {
    status: 'discharged',
    detail: 'All evidence still satisfies the obligation.',
    durationMs: 1400,
  },
  partial: {
    status: 'partial',
    detail: 'Coverage unchanged. One handler remains uncovered (reject path).',
    durationMs: 1800,
  },
  unproven: {
    status: 'unproven',
    detail: 'No new evidence found. Implementation needs to land before this can pass.',
    durationMs: 1100,
  },
  stale: {
    status: 'partial',
    detail: 'Re-ran against current code. Two assertions pass, one is now flagged for review.',
    durationMs: 2100,
  },
}

export function ReVerifyButton({ current, outcome, size = 'sm', className }: Props) {
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle')
  const [result, setResult] = useState<Outcome | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  function start() {
    if (state === 'running') return
    const planned = outcome ?? DEFAULTS[current]
    setState('running')
    setResult(null)
    timerRef.current = setTimeout(() => {
      setResult(planned)
      setState('done')
    }, planned.durationMs)
  }

  function reset() {
    setState('idle')
    setResult(null)
  }

  const buttonCls = cn(
    'inline-flex items-center gap-2 rounded-full border transition-colors disabled:opacity-50',
    size === 'sm' ? 'px-3 py-1 text-[11px]' : 'px-4 py-1.5 text-xs',
    state === 'running'
      ? 'border-accent/40 bg-accent/5 text-accent'
      : 'border-border bg-bg text-fg hover:bg-surface',
    className,
  )

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={start}
        disabled={state === 'running'}
        className={buttonCls}
      >
        {state === 'running' ? <Spinner /> : <PlayIcon />}
        {state === 'running' ? 'Verifying…' : 'Re-verify'}
      </button>

      {state === 'done' && result && (
        <div
          role="status"
          aria-live="polite"
          className="w-full max-w-sm rounded-md border border-border bg-bg p-3 text-left text-xs animate-reveal"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
              Result
            </span>
            <span className="font-mono text-[10px] text-subtle">
              {(result.durationMs / 1000).toFixed(1)}s
            </span>
          </div>
          <div className="mt-1.5 text-fg">{result.detail}</div>
          <button
            type="button"
            onClick={reset}
            className="mt-2 text-[10px] uppercase tracking-widest text-subtle hover:text-fg"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden className="animate-spin">
      <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2" opacity="0.25" />
      <path
        d="M9.5 5.5a4 4 0 0 1-4 4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
      <path d="M2 1.5L7.5 4.5L2 7.5V1.5Z" fill="currentColor" />
    </svg>
  )
}
