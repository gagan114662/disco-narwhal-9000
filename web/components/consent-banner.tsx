'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'kairos-consent'
const SHOW_EVENT = 'kairos:consent-open'

type Choice = 'accepted' | 'rejected'

type StoredConsent = {
  choice: Choice
  setAt: string
  version: number
}

const VERSION = 1

function readStored(): StoredConsent | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredConsent
    if (parsed.version !== VERSION) return null
    return parsed
  } catch {
    return null
  }
}

function writeStored(choice: Choice): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ choice, setAt: new Date().toISOString(), version: VERSION } satisfies StoredConsent),
    )
  } catch {
    // localStorage unavailable — silently no-op
  }
}

export function ConsentBanner() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (readStored() === null) setOpen(true)
    const reopen = () => setOpen(true)
    window.addEventListener(SHOW_EVENT, reopen)
    return () => window.removeEventListener(SHOW_EVENT, reopen)
  }, [])

  const decide = useCallback((choice: Choice) => {
    writeStored(choice)
    setOpen(false)
  }, [])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 sm:px-4 sm:pb-4 pointer-events-none"
    >
      <div className="pointer-events-auto mx-auto max-w-3xl rounded-xl border border-border bg-bg/95 backdrop-blur-md shadow-[0_-4px_32px_-12px_rgba(0,0,0,0.18)] p-4 md:p-5">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-widest text-subtle">Cookies</div>
            <p className="mt-1.5 text-sm text-fg text-pretty">
              We don’t run third-party analytics on this site today. If we add any, they’re
              opt-in and disclosed in{' '}
              <Link
                href="/legal/telemetry"
                className="underline underline-offset-4 hover:text-accent"
              >
                /legal/telemetry
              </Link>
              . Strictly necessary cookies (theme preference, this banner’s memory) only.
            </p>
          </div>
          <div className="flex flex-shrink-0 flex-wrap gap-2 md:justify-end">
            <button
              type="button"
              onClick={() => decide('rejected')}
              className="inline-flex items-center justify-center rounded-full border border-border px-4 py-2 text-xs hover:bg-surface transition-colors"
            >
              Reject non-essential
            </button>
            <button
              type="button"
              onClick={() => decide('accepted')}
              className="inline-flex items-center justify-center rounded-full bg-fg text-bg px-4 py-2 text-xs hover:opacity-90 transition-opacity"
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function openConsentBanner(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SHOW_EVENT))
}
