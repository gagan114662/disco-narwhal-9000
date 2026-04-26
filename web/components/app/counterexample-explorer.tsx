'use client'

import { useEffect, useState } from 'react'
import type {
  CodeRange,
  Counterexample,
  CounterexampleStep,
} from '@/lib/diff-data'
import { cn } from '@/lib/cn'

type ChipKind = 'shrink' | 'explain' | 'propose-fix'

type Response = {
  kind: ChipKind
  text: string
  stepId: string | null
}

type Props = {
  counterexample: Counterexample
  /** Optional callback so the parent can scroll the diff to a step's range. */
  onJumpToRange?: (range: CodeRange) => void
}

const RESPONSE_DELAY_MS = 1100

export function CounterexampleExplorer({ counterexample, onJumpToRange }: Props) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [shrunk, setShrunk] = useState(false)
  const [running, setRunning] = useState<ChipKind | null>(null)
  const [response, setResponse] = useState<Response | null>(null)
  const [expanded, setExpanded] = useState(false)

  const activeStep = counterexample.steps[activeIdx] ?? counterexample.steps[0]

  // Reset response when active step changes (so an old explain/fix doesn't bleed across steps).
  useEffect(() => {
    if (response && response.stepId !== (activeStep?.id ?? null)) {
      setResponse(null)
      setRunning(null)
    }
  }, [activeIdx, activeStep, response])

  // Esc closes the expanded modal.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  if (!activeStep) return null

  function fire(kind: ChipKind) {
    if (running) return
    setRunning(kind)
    setResponse(null)
    const target = activeStep!
    const delay = RESPONSE_DELAY_MS
    setTimeout(() => {
      setRunning(null)
      setResponse({
        kind,
        stepId: kind === 'shrink' ? null : target.id,
        text: buildResponse(kind, target, counterexample),
      })
    }, delay)
  }

  const proposeFixAvailable = activeStep.range !== undefined

  return (
    <>
      <section className="border-b border-border bg-bg">
        <ExplorerHeader
          counterexample={counterexample}
          activeStepIdx={activeIdx}
          shrunk={shrunk}
          onShrink={() => setShrunk((v) => !v)}
          onExpand={() => setExpanded(true)}
        />

        <Stepper
          steps={counterexample.steps}
          activeIdx={activeIdx}
          onSelect={setActiveIdx}
        />

        <ActiveStepCard
          step={activeStep}
          stepIdx={activeIdx}
          shrunk={shrunk}
          onJumpToRange={onJumpToRange}
        />

        <ChipRow
          running={running}
          activeKind={response?.kind ?? null}
          proposeFixAvailable={proposeFixAvailable}
          onFire={fire}
        />

        {(running || response) && (
          <ResponseCard
            running={running}
            response={response}
            onJumpToRange={
              activeStep.range && response?.kind === 'propose-fix'
                ? () => onJumpToRange?.(activeStep.range!)
                : undefined
            }
            onDismiss={() => setResponse(null)}
          />
        )}
      </section>

      {expanded && (
        <FullScreenExplorer
          counterexample={counterexample}
          activeIdx={activeIdx}
          onSelect={setActiveIdx}
          running={running}
          response={response}
          onFire={fire}
          onClose={() => setExpanded(false)}
          onJumpToRange={onJumpToRange}
        />
      )}
    </>
  )
}

function ExplorerHeader({
  counterexample,
  activeStepIdx,
  shrunk,
  onShrink,
  onExpand,
}: {
  counterexample: Counterexample
  activeStepIdx: number
  shrunk: boolean
  onShrink: () => void
  onExpand: () => void
}) {
  return (
    <header className="px-3 pt-3 pb-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-rose-700 dark:text-rose-400">
          Counterexample · step {activeStepIdx + 1}/{counterexample.steps.length}
        </div>
        <button
          type="button"
          onClick={onExpand}
          className="text-[11px] text-muted hover:text-fg transition-colors"
          aria-label="Open counterexample full screen"
        >
          Expand →
        </button>
      </div>
      {!shrunk && (
        <p className="mt-1.5 text-[12px] text-fg text-pretty leading-snug">
          {counterexample.summary}
        </p>
      )}
      <button
        type="button"
        onClick={onShrink}
        className="mt-1 text-[10px] uppercase tracking-widest text-subtle hover:text-fg transition-colors"
      >
        {shrunk ? 'Show summary' : 'Hide summary'}
      </button>
    </header>
  )
}

function Stepper({
  steps,
  activeIdx,
  onSelect,
}: {
  steps: CounterexampleStep[]
  activeIdx: number
  onSelect: (i: number) => void
}) {
  return (
    <ol
      role="tablist"
      className="px-3 pb-2 flex items-center gap-1.5 overflow-x-auto"
    >
      {steps.map((step, i) => {
        const active = i === activeIdx
        const visited = i < activeIdx
        return (
          <li key={step.id} className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(i)}
              title={step.label}
              className={cn(
                'inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-full border text-[10px] font-mono transition-colors',
                active
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-1 ring-rose-500/30'
                  : visited
                    ? 'border-border bg-surface text-fg'
                    : 'border-border bg-bg text-muted hover:bg-surface',
              )}
            >
              {i + 1}
            </button>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'h-px w-3',
                  visited ? 'bg-fg/30' : 'bg-border',
                )}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

function ActiveStepCard({
  step,
  stepIdx,
  shrunk,
  onJumpToRange,
}: {
  step: CounterexampleStep
  stepIdx: number
  shrunk: boolean
  onJumpToRange?: (range: CodeRange) => void
}) {
  return (
    <div className="px-3 py-2">
      <div className="rounded-md border border-rose-500/30 bg-rose-500/[0.06] p-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] text-subtle">S{stepIdx + 1}</span>
          <span className="font-serif text-sm tracking-tight text-fg leading-snug">
            {step.label}
          </span>
        </div>
        {!shrunk && step.detail && (
          <p className="mt-1.5 text-[11px] text-muted leading-snug">{step.detail}</p>
        )}
        {step.range && (
          <button
            type="button"
            onClick={() => onJumpToRange?.(step.range!)}
            className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] text-accent hover:underline underline-offset-4"
          >
            jump to L{step.range.start}–L{step.range.end} →
          </button>
        )}
      </div>
    </div>
  )
}

function ChipRow({
  running,
  activeKind,
  proposeFixAvailable,
  onFire,
}: {
  running: ChipKind | null
  activeKind: ChipKind | null
  proposeFixAvailable: boolean
  onFire: (kind: ChipKind) => void
}) {
  return (
    <div className="px-3 pb-3 flex flex-wrap gap-1.5">
      <Chip
        label="Shrink"
        running={running === 'shrink'}
        active={activeKind === 'shrink'}
        onClick={() => onFire('shrink')}
        disabled={running !== null && running !== 'shrink'}
      />
      <Chip
        label="Explain"
        running={running === 'explain'}
        active={activeKind === 'explain'}
        onClick={() => onFire('explain')}
        disabled={running !== null && running !== 'explain'}
      />
      <Chip
        label="Propose fix"
        running={running === 'propose-fix'}
        active={activeKind === 'propose-fix'}
        onClick={() => onFire('propose-fix')}
        disabled={!proposeFixAvailable || (running !== null && running !== 'propose-fix')}
        hint={
          !proposeFixAvailable
            ? 'No code range on this step. Pick a step with a jump target.'
            : undefined
        }
      />
    </div>
  )
}

function Chip({
  label,
  running,
  active,
  disabled,
  hint,
  onClick,
}: {
  label: string
  running: boolean
  active: boolean
  disabled?: boolean
  hint?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        running
          ? 'border-accent/40 bg-accent/5 text-accent'
          : active
            ? 'border-fg bg-fg text-bg'
            : 'border-border bg-bg text-fg hover:bg-surface',
      )}
    >
      {running && <Spinner />}
      {label}
    </button>
  )
}

function ResponseCard({
  running,
  response,
  onJumpToRange,
  onDismiss,
}: {
  running: ChipKind | null
  response: Response | null
  onJumpToRange?: () => void
  onDismiss: () => void
}) {
  if (running) {
    return (
      <div className="mx-3 mb-3 rounded-md border border-accent/30 bg-accent/5 p-3 text-[12px] text-accent">
        <div className="flex items-center gap-2">
          <Spinner /> Asking the agent…
        </div>
      </div>
    )
  }
  if (!response) return null
  const labels: Record<ChipKind, string> = {
    shrink: 'Shrunk',
    explain: 'Explanation',
    'propose-fix': 'Proposed fix',
  }
  return (
    <div className="mx-3 mb-3 rounded-md border border-border bg-bg p-3 animate-reveal">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-subtle">
          {labels[response.kind]}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[10px] uppercase tracking-widest text-subtle hover:text-fg transition-colors"
        >
          Dismiss
        </button>
      </div>
      <p className="mt-1.5 text-[12px] text-fg text-pretty leading-relaxed">
        {response.text}
      </p>
      {onJumpToRange && response.kind === 'propose-fix' && (
        <button
          type="button"
          onClick={onJumpToRange}
          className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] text-accent hover:underline underline-offset-4"
        >
          show me where →
        </button>
      )}
    </div>
  )
}

function FullScreenExplorer({
  counterexample,
  activeIdx,
  onSelect,
  running,
  response,
  onFire,
  onClose,
  onJumpToRange,
}: {
  counterexample: Counterexample
  activeIdx: number
  onSelect: (i: number) => void
  running: ChipKind | null
  response: Response | null
  onFire: (kind: ChipKind) => void
  onClose: () => void
  onJumpToRange?: (range: CodeRange) => void
}) {
  const activeStep = counterexample.steps[activeIdx] ?? counterexample.steps[0]
  if (!activeStep) return null

  return (
    <div
      role="dialog"
      aria-label="Counterexample full screen"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-bg/95 backdrop-blur-sm"
    >
      <header className="flex-shrink-0 border-b border-border px-5 md:px-8 py-3 flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-rose-700 dark:text-rose-400">
            Counterexample · {counterexample.steps.length} steps
          </div>
          <p className="mt-1 font-serif text-base tracking-tight text-fg max-w-3xl text-balance">
            {counterexample.summary}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs hover:bg-surface transition-colors"
        >
          Close
          <kbd className="font-mono text-[10px] rounded border border-border px-1 py-0.5">esc</kbd>
        </button>
      </header>

      <div className="flex-1 overflow-auto px-5 md:px-8 py-6">
        <ol className="grid gap-3 md:gap-4">
          {counterexample.steps.map((step, i) => {
            const active = i === activeIdx
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => onSelect(i)}
                  className={cn(
                    'group w-full text-left grid grid-cols-[40px,1fr] gap-4 rounded-md border p-4 transition-colors',
                    active
                      ? 'border-rose-500/40 bg-rose-500/[0.06]'
                      : 'border-border bg-bg hover:bg-surface/40',
                  )}
                >
                  <div
                    className={cn(
                      'inline-flex h-9 w-9 items-center justify-center rounded-full border font-mono text-sm',
                      active
                        ? 'border-rose-500/40 bg-bg text-rose-700 dark:text-rose-400'
                        : 'border-border bg-surface text-fg',
                    )}
                  >
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="font-serif text-base tracking-tight text-fg">
                      {step.label}
                    </div>
                    {step.detail && (
                      <p className="mt-1.5 text-sm text-muted text-pretty max-w-prose leading-relaxed">
                        {step.detail}
                      </p>
                    )}
                    {step.range && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onJumpToRange?.(step.range!)
                          onClose()
                        }}
                        className="mt-3 inline-flex items-center gap-1 font-mono text-[11px] text-accent hover:underline underline-offset-4"
                      >
                        jump to L{step.range.start}–L{step.range.end} →
                      </button>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ol>

        <section className="mt-8 border-t border-border pt-6 max-w-3xl">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[10px] uppercase tracking-widest text-subtle">
              Agent · pinned to S{activeIdx + 1}
            </div>
            <span className="font-mono text-[11px] text-muted">{activeStep.label}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip
              label="Shrink"
              running={running === 'shrink'}
              active={response?.kind === 'shrink'}
              onClick={() => onFire('shrink')}
              disabled={running !== null && running !== 'shrink'}
            />
            <Chip
              label="Explain"
              running={running === 'explain'}
              active={response?.kind === 'explain'}
              onClick={() => onFire('explain')}
              disabled={running !== null && running !== 'explain'}
            />
            <Chip
              label="Propose fix"
              running={running === 'propose-fix'}
              active={response?.kind === 'propose-fix'}
              onClick={() => onFire('propose-fix')}
              disabled={
                !activeStep.range || (running !== null && running !== 'propose-fix')
              }
              hint={!activeStep.range ? 'No code range on this step.' : undefined}
            />
          </div>
          {(running || response) && (
            <div className="mt-4 rounded-md border border-border bg-bg p-4">
              {running ? (
                <div className="flex items-center gap-2 text-sm text-accent">
                  <Spinner /> Asking the agent…
                </div>
              ) : response ? (
                <>
                  <div className="text-[10px] uppercase tracking-widest text-subtle">
                    {response.kind === 'shrink'
                      ? 'Shrunk'
                      : response.kind === 'explain'
                        ? 'Explanation'
                        : 'Proposed fix'}
                  </div>
                  <p className="mt-1.5 text-sm text-fg text-pretty leading-relaxed max-w-prose">
                    {response.text}
                  </p>
                </>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function buildResponse(
  kind: ChipKind,
  step: CounterexampleStep,
  ce: Counterexample,
): string {
  const canned =
    kind === 'shrink'
      ? ce.mockResponses?.shrink
      : kind === 'explain'
        ? ce.mockResponses?.explain?.[step.id]
        : ce.mockResponses?.proposeFix?.[step.id]
  if (canned) return canned

  const obls = ce.obligationIds.length ? ce.obligationIds.join(' + ') : 'the cited obligations'
  if (kind === 'shrink') {
    return `Trace shrinks to the steps that carry a code range. Drop narrative steps; the failure reproduces from the ranged steps alone. Obligations affected: ${obls}.`
  }
  if (kind === 'explain') {
    return `${step.label}. ${
      step.detail ?? ''
    } The reviewer flagged this against ${obls}.`.trim()
  }
  // propose-fix
  if (!step.range) {
    return `No code range on this step. Pick a ranged step (S${
      ce.steps.findIndex((s) => Boolean(s.range)) + 1
    }) to get a concrete patch.`
  }
  return `Suggested patch at L${step.range.start}–L${step.range.end}, anchored to ${obls}. Apply the constraint the obligation requires and re-run the eval pack.`
}

function Spinner() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 11 11"
      fill="none"
      aria-hidden
      className="animate-spin flex-shrink-0"
    >
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
