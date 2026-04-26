'use client'

import { useState } from 'react'
import { cn } from '@/lib/cn'

export type NotifyIntent =
  | 'cloud-pro'
  | 'enterprise'
  | 'updates'
  | 'docs'
  | 'community'
  | 'careers'
  | 'research'
  | 'changelog'
  | 'blog'
  | 'press'
  | 'general'

type ExtraField = 'team-size' | 'deployment-model' | 'role'

type Props = {
  intent: NotifyIntent
  cta: string
  hint?: string
  fields?: ExtraField[]
  layout?: 'inline' | 'stacked'
  successMessage?: string
}

const TEAM_SIZE_OPTIONS = ['Just me', '2–10', '11–50', '51–200', '200+']
const DEPLOYMENT_OPTIONS = [
  'Local OSS',
  'Cloud (hosted)',
  'On-prem / self-host',
  'Air-gap',
]
const ROLE_OPTIONS = ['Engineer', 'Eng leadership', 'Security / compliance', 'Product', 'Other']

export function NotifyForm({
  intent,
  cta,
  hint,
  fields = [],
  layout = 'inline',
  successMessage = 'Thanks — you’re on the list.',
}: Props) {
  const [state, setState] = useState<'idle' | 'submitting' | 'ok' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Capture the form before awaiting — React nulls e.currentTarget after await.
    const form = e.currentTarget
    setState('submitting')
    setErrorMessage(null)

    const data = new FormData(form)
    const payload: Record<string, string> = { intent }
    for (const [k, v] of data.entries()) {
      if (typeof v === 'string') payload[k] = v
    }

    let res: Response
    try {
      res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      setErrorMessage('Network error.')
      setState('error')
      return
    }

    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      setErrorMessage(json?.error === 'invalid_email' ? 'That email looks off.' : 'Something went wrong.')
      setState('error')
      return
    }

    setState('ok')
    form.reset()
  }

  if (state === 'ok') {
    return (
      <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
        <span className="text-accent">✓</span> <span className="text-fg">{successMessage}</span>
      </div>
    )
  }

  const inputCls =
    'flex-1 min-w-0 rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-subtle focus-visible:border-accent'
  const selectCls =
    'rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus-visible:border-accent'

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'flex w-full',
        layout === 'inline' ? 'flex-col sm:flex-row gap-2' : 'flex-col gap-3',
      )}
    >
      <input
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder="you@company.com"
        aria-label="Email"
        className={inputCls}
      />

      {fields.includes('team-size') && (
        <select name="teamSize" defaultValue="" className={selectCls} aria-label="Team size">
          <option value="" disabled>
            Team size
          </option>
          {TEAM_SIZE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      {fields.includes('deployment-model') && (
        <select
          name="deployment"
          defaultValue=""
          className={selectCls}
          aria-label="Deployment model"
        >
          <option value="" disabled>
            Deployment
          </option>
          {DEPLOYMENT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      {fields.includes('role') && (
        <select name="role" defaultValue="" className={selectCls} aria-label="Role">
          <option value="" disabled>
            Role
          </option>
          {ROLE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      <button
        type="submit"
        disabled={state === 'submitting'}
        className={cn(
          'inline-flex items-center justify-center rounded-md bg-fg text-bg px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50',
          layout === 'inline' ? 'sm:w-auto w-full' : 'w-full',
        )}
      >
        {state === 'submitting' ? 'Sending…' : cta}
      </button>

      {hint && <p className="text-xs text-subtle">{hint}</p>}
      {state === 'error' && errorMessage && (
        <p className="text-xs text-fg">{errorMessage}</p>
      )}
    </form>
  )
}
