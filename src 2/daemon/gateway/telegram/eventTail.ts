// Tail ~/.claude/kairos/events.jsonl and forward interesting events to
// Telegram.
//
// The issue specifies "a Tier 3 surfaced message should land in Telegram
// without additional code in tier3.ts" — so rather than plumbing callbacks
// through the worker, we tail the global event log. This keeps tier3.ts /
// capHit / reminder-firing completely unaware of Telegram.
//
// We start tailing from the current end-of-file. Replaying the whole
// history on gateway start would flood the user with stale surfaces after
// every daemon restart.
//
// Implementation: simple poll loop. `fs.watch` is unreliable on macOS
// (FSEvents coalesces / sometimes drops appends) so we read-from-offset
// on a timer. The extra IO is negligible — the file appends once per
// fire / surface.

import { open, stat } from 'fs/promises'
import type { OutboundQueue } from './outbound.js'

const TAIL_BUFFER_LIMIT = 64 * 1024
const DEFAULT_POLL_MS = 500

export type EventKind =
  | 'tier3_surface'
  | 'cap_hit_notice'
  | 'fired'
  | 'finished'
  | (string & {})

export type TailableEvent = {
  kind: EventKind
  t?: string
  message?: string
  scope?: string
  cap?: number
  current?: number
  projectDir?: string
  taskId?: string
  cron?: string
}

export function formatEventForTelegram(event: TailableEvent): string | null {
  switch (event.kind) {
    case 'tier3_surface':
      if (!event.message) return null
      return `💡 KAIROS: ${event.message}`
    case 'cap_hit_notice': {
      const scope = event.scope ?? 'global'
      const cap = event.cap !== undefined ? `$${event.cap.toFixed(2)}` : '?'
      const current =
        event.current !== undefined ? `$${event.current.toFixed(2)}` : '?'
      return `🛑 KAIROS cap hit (${scope}): ${current} / ${cap}. Daemon paused.`
    }
    case 'fired': {
      const task = event.taskId ?? 'unknown'
      return `⏰ KAIROS reminder fired: ${task}`
    }
    default:
      return null
  }
}

export type EventTailDeps = {
  path: string
  outboundChatIds: () => Promise<number[]>
  outbound: OutboundQueue
  pollMs?: number
  onError?: (err: Error) => void
  /** Override start offset — tests use 0 so they don't have to pre-seed. */
  startAtOffset?: number
}

export type EventTail = {
  start(): Promise<void>
  stop(): Promise<void>
  /** Force a read cycle. Tests use this to deterministically drain pending appends. */
  tick(): Promise<void>
}

export function createEventTail(deps: EventTailDeps): EventTail {
  let offset = deps.startAtOffset ?? 0
  let partial = ''
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null

  async function setInitialOffset(): Promise<void> {
    if (deps.startAtOffset !== undefined) return
    try {
      const s = await stat(deps.path)
      offset = s.size
    } catch {
      offset = 0
    }
  }

  async function readPass(): Promise<void> {
    let handle
    try {
      handle = await open(deps.path, 'r')
    } catch {
      return
    }
    try {
      while (true) {
        const stats = await handle.stat()
        if (stats.size < offset) {
          offset = 0
          partial = ''
        }
        if (stats.size === offset) return
        const length = Math.min(stats.size - offset, TAIL_BUFFER_LIMIT)
        const buf = Buffer.alloc(length)
        await handle.read(buf, 0, length, offset)
        offset += length
        partial += buf.toString('utf8')

        const lines = partial.split('\n')
        partial = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          let event: TailableEvent | null = null
          try {
            event = JSON.parse(line) as TailableEvent
          } catch (error) {
            deps.onError?.(error as Error)
            continue
          }
          const formatted = event ? formatEventForTelegram(event) : null
          if (!formatted) continue
          const chatIds = await deps.outboundChatIds()
          for (const chatId of chatIds) {
            try {
              await deps.outbound.send({ chat_id: chatId, text: formatted })
            } catch (error) {
              deps.onError?.(error as Error)
            }
          }
        }
      }
    } finally {
      await handle.close()
    }
  }

  async function tick(): Promise<void> {
    if (running) {
      await running
      return
    }
    running = readPass().catch(err => {
      deps.onError?.(err as Error)
    })
    try {
      await running
    } finally {
      running = null
    }
  }

  function scheduleNext(): void {
    if (stopped) return
    timer = setTimeout(async () => {
      timer = null
      await tick()
      scheduleNext()
    }, deps.pollMs ?? DEFAULT_POLL_MS)
    timer.unref?.()
  }

  return {
    async start() {
      await setInitialOffset()
      await tick()
      scheduleNext()
    },
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      if (running) await running
    },
    tick,
  }
}
