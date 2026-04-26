'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AGENT_DEFAULT_CHIPS,
  AGENT_DEFAULT_THREAD,
  AGENT_MENTION_SUGGESTIONS,
  type AgentMessage,
} from '@/lib/app-data'
import { cn } from '@/lib/cn'
import { formatTimeOfDay } from '@/lib/format-time'

type PinnedContext = {
  id: string
  kind: 'requirement' | 'obligation' | 'work-order' | 'blueprint' | 'file'
  label: string
}

type Banner = {
  tone: 'info' | 'warn' | 'error'
  text: string
} | null

type Props = {
  title?: string
  banner?: Banner
  pinned?: PinnedContext[]
  chips?: readonly string[]
  initialThread?: AgentMessage[]
  /** When true, the rail does not render its own title bar / collapse button.
   *  Use when a parent (e.g. <DockedAgentRail>) already provides chrome. */
  hideHeader?: boolean
  /** Optional content rendered between the banner and the chip row.
   *  Used by the diff route to embed the counterexample explorer. */
  featured?: React.ReactNode
}

const KIND_GLYPH: Record<PinnedContext['kind'], string> = {
  requirement: '§',
  obligation: '◆',
  'work-order': '⊞',
  blueprint: '⌬',
  file: '⎙',
}

export function AgentRail({
  title = 'Agent',
  banner = null,
  pinned = [],
  chips = AGENT_DEFAULT_CHIPS,
  initialThread = AGENT_DEFAULT_THREAD,
  hideHeader = false,
  featured,
}: Props) {
  const [thread, setThread] = useState<AgentMessage[]>(initialThread)
  const [draft, setDraft] = useState('')
  const [showMentions, setShowMentions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filteredMentions = useMemo(() => {
    if (!showMentions) return []
    const q = mentionQuery.toLowerCase()
    return AGENT_MENTION_SUGGESTIONS.filter(
      (s) =>
        s.id.toLowerCase().includes(q) || s.label.toLowerCase().includes(q),
    ).slice(0, 6)
  }, [showMentions, mentionQuery])

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [thread.length])

  function pushUserMessage(text: string) {
    setThread((prev) => [
      ...prev,
      {
        id: `u-${prev.length + 1}`,
        role: 'user',
        t: new Date().toISOString(),
        text,
      },
      // mock agent ack
      {
        id: `a-${prev.length + 2}`,
        role: 'agent',
        t: new Date().toISOString(),
        tone: 'neutral',
        text: 'Acknowledged. Threading this against the pinned context.',
      },
    ])
  }

  function handleChip(label: string) {
    pushUserMessage(label)
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) return
    pushUserMessage(trimmed)
    setDraft('')
    setShowMentions(false)
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value
    setDraft(v)
    const cursor = e.target.selectionStart ?? v.length
    const before = v.slice(0, cursor)
    const m = before.match(/(?:^|\s)@([\w-]*)$/)
    if (m) {
      setShowMentions(true)
      setMentionQuery(m[1] ?? '')
      setMentionIndex(0)
    } else {
      setShowMentions(false)
    }
  }

  function applyMention(suggestion: (typeof AGENT_MENTION_SUGGESTIONS)[number]) {
    const cursor = composerRef.current?.selectionStart ?? draft.length
    const before = draft.slice(0, cursor)
    const after = draft.slice(cursor)
    const replaced = before.replace(/(?:^|\s)@([\w-]*)$/, (match) => {
      const lead = match.startsWith(' ') ? ' ' : ''
      return `${lead}@${suggestion.id} `
    })
    const next = replaced + after
    setDraft(next)
    setShowMentions(false)
    requestAnimationFrame(() => composerRef.current?.focus())
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showMentions && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % filteredMentions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(
          (i) => (i - 1 + filteredMentions.length) % filteredMentions.length,
        )
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const choice = filteredMentions[mentionIndex]
        if (choice) applyMention(choice)
        return
      }
      if (e.key === 'Escape') {
        setShowMentions(false)
        return
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      onSubmit(e as unknown as React.FormEvent)
    }
  }

  if (collapsed) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-subtle">{title}</div>
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="text-xs text-muted hover:text-fg transition-colors"
          >
            Expand
          </button>
        </div>
        <div className="flex-1 px-4 py-6 text-xs text-muted">
          Collapsed. {thread.length} message{thread.length === 1 ? '' : 's'} in thread.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {!hideHeader && (
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-subtle">{title}</div>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="text-xs text-muted hover:text-fg transition-colors"
            aria-label="Collapse agent rail"
          >
            Collapse
          </button>
        </div>
      )}

      {banner && (
        <div
          className={cn(
            'border-b border-border px-4 py-3 text-xs',
            banner.tone === 'error' && 'bg-rose-500/5 text-rose-700 dark:text-rose-400',
            banner.tone === 'warn' && 'bg-amber-500/5 text-amber-700 dark:text-amber-400',
            banner.tone === 'info' && 'bg-accent/5 text-accent',
          )}
        >
          {banner.text}
        </div>
      )}

      {featured && (
        <div className="flex-shrink-0 max-h-[55%] overflow-auto">{featured}</div>
      )}

      <div className="border-b border-border px-3 py-2.5 flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => handleChip(chip)}
            className="rounded-full border border-border bg-bg px-2.5 py-1 text-[11px] text-fg hover:bg-surface transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>

      <div ref={listRef} className="flex-1 overflow-auto px-4 py-4 space-y-4 min-h-0">
        {thread.map((m) => (
          <Message key={m.id} message={m} />
        ))}
      </div>

      {pinned.length > 0 && (
        <div className="border-t border-border px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-widest text-subtle px-1 pb-1.5">
            Pinned context
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {pinned.map((p) => (
              <li
                key={p.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[11px]"
              >
                <span className="text-subtle">{KIND_GLYPH[p.kind]}</span>
                <span className="font-mono text-fg">{p.id}</span>
                <span className="text-muted truncate max-w-[140px]">{p.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={onSubmit} className="border-t border-border px-3 py-3 relative">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={onChange}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Message the agent. Type @ to reference."
          className="w-full resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-subtle focus-visible:border-accent"
        />

        {showMentions && filteredMentions.length > 0 && (
          <div className="absolute bottom-[calc(100%-4px)] left-3 right-3 z-10 rounded-md border border-border bg-bg shadow-lg overflow-hidden">
            <ul role="listbox" className="max-h-56 overflow-auto">
              {filteredMentions.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      applyMention(s)
                    }}
                    onMouseEnter={() => setMentionIndex(i)}
                    className={cn(
                      'w-full text-left flex items-center gap-3 px-3 py-2 text-xs transition-colors',
                      i === mentionIndex ? 'bg-surface' : 'hover:bg-surface/60',
                    )}
                  >
                    <span className="font-mono text-[10px] text-subtle w-12">{s.id}</span>
                    <span className="text-fg truncate">{s.label}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-widest text-subtle">
                      {s.kind}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-1.5 text-[11px] text-muted px-2 py-1 rounded-md hover:bg-surface transition-colors disabled:opacity-50"
            aria-label="Upload file"
          >
            <UploadIcon /> Upload
          </button>
          <div className="flex items-center gap-2 text-[10px] text-subtle">
            <kbd className="font-mono rounded border border-border px-1 py-0.5">⌘</kbd>
            <kbd className="font-mono rounded border border-border px-1 py-0.5">↵</kbd>
            <span>to send</span>
            <button
              type="submit"
              disabled={!draft.trim()}
              className="ml-2 inline-flex items-center rounded-full bg-fg text-bg px-3 py-1 text-xs hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function Message({ message }: { message: AgentMessage }) {
  const time = formatTimeOfDay(message.t)
  if (message.role === 'system') {
    return (
      <div className="text-[11px] font-mono text-subtle">
        <span className="mr-2">{time}</span>
        {message.text}
      </div>
    )
  }
  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="rounded-lg bg-fg text-bg px-3 py-2 text-sm max-w-[85%] break-words">
          {message.text}
        </div>
        <div className="text-[10px] font-mono text-subtle">{time}</div>
      </div>
    )
  }
  const tone = message.tone ?? 'neutral'
  return (
    <div className="flex gap-2.5">
      <div className="mt-1 h-6 w-6 flex-shrink-0 rounded-full border border-border bg-surface flex items-center justify-center text-[10px] font-mono text-fg">
        AI
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-mono text-subtle mb-1">
          agent · {time}
          {tone === 'evidence' && ' · evidence'}
          {tone === 'warning' && ' · warning'}
        </div>
        <div
          className={cn(
            'rounded-lg border px-3 py-2 text-sm text-fg',
            tone === 'evidence'
              ? 'border-accent/30 bg-accent/5'
              : tone === 'warning'
                ? 'border-amber-500/30 bg-amber-500/5'
                : 'border-border bg-surface/40',
          )}
        >
          {message.text}
        </div>
      </div>
    </div>
  )
}

function UploadIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
      <path
        d="M5.5 8V2M2.5 4.5L5.5 1.5L8.5 4.5M2 9.5h7"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
