// Top-level Telegram gateway controller.
//
// Responsibilities:
//
//   * Long-poll getUpdates with an ever-advancing offset so Telegram never
//     replays the same update twice.
//   * Reconnect with exponential backoff on network / Bot API errors.
//   * For each inbound update, hand off to handleInboundMessage to decide
//     ignore / reply / pair.
//   * Tail ~/.claude/kairos/events.jsonl and forward surfaces / cap-hits
//     / reminder firings to every paired chat.
//
// The controller is stoppable via AbortSignal so the worker's shutdown
// path can cancel an in-flight long-poll instantly.

import { readTelegramConfig } from './config.js'
import { createEventTail, type EventTail } from './eventTail.js'
import { handleInboundMessage } from './inbound.js'
import { createOutboundQueue, type OutboundQueue } from './outbound.js'
import { createTelegramTransport, type TelegramTransport } from './transport.js'
import type { DispatchInput, DispatchResult } from './commands.js'

const LONG_POLL_TIMEOUT_S = 30
const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MAX_MS = 60_000

export type GatewayDeps = {
  token: string
  configPath?: string
  pendingPath?: string
  eventPath: string
  dispatch: (input: DispatchInput) => Promise<DispatchResult>
  /** Injected so tests can stub; defaults to the real fetch-based transport. */
  transport?: TelegramTransport
  outbound?: OutboundQueue
  tail?: EventTail
  pollIntervalMs?: number
  signal?: AbortSignal
  log?: (msg: string) => void
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}

export type Gateway = {
  start(): Promise<void>
  stop(): Promise<void>
}

const DEFAULT_SLEEP = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms)
  })

export function createGateway(deps: GatewayDeps): Gateway {
  const log = deps.log ?? (() => {})
  const sleep = deps.sleep ?? DEFAULT_SLEEP
  // Internal controller abort is how stop() cancels an in-flight long-poll.
  // If the caller supplied a signal, chain it so either triggers shutdown.
  const internalController = new AbortController()
  if (deps.signal) {
    if (deps.signal.aborted) internalController.abort()
    else deps.signal.addEventListener('abort', () => internalController.abort(), { once: true })
  }
  const signal = internalController.signal
  const transport =
    deps.transport ?? createTelegramTransport(deps.token, { signal })
  const outbound = deps.outbound ?? createOutboundQueue({ transport })
  const rejectedChatIds = new Set<number>()

  const tail =
    deps.tail ??
    createEventTail({
      path: deps.eventPath,
      outboundChatIds: async () => {
        const config = await readTelegramConfig(deps.configPath)
        return config?.pairedChatIds ?? []
      },
      outbound,
      onError: err => log(`event tail error: ${err.message}`),
    })

  let stopped = false
  let offset = 0
  let loopPromise: Promise<void> | null = null

  async function pollOnce(): Promise<void> {
    const updates = await transport.getUpdates({
      offset,
      timeout: LONG_POLL_TIMEOUT_S,
      allowed_updates: ['message'],
    })
    for (const update of updates) {
      offset = update.update_id + 1
      const message = update.message ?? update.edited_message
      if (!message) continue
      const action = await handleInboundMessage(message, {
        dispatch: deps.dispatch,
        rejectedChatIds,
        configPath: deps.configPath,
        pendingPath: deps.pendingPath,
        now: deps.now,
      })
      if (action.kind === 'reply' || action.kind === 'paired') {
        try {
          await outbound.send({ chat_id: action.chatId, text: action.text })
        } catch (err) {
          log(`outbound send failed: ${(err as Error).message}`)
        }
      }
    }
  }

  async function runLoop(): Promise<void> {
    let backoff = BACKOFF_INITIAL_MS
    while (!stopped && !signal?.aborted) {
      try {
        await pollOnce()
        backoff = BACKOFF_INITIAL_MS
      } catch (err) {
        if (stopped || signal?.aborted) return
        log(`getUpdates failed (${(err as Error).message}); sleeping ${backoff}ms`)
        await sleep(backoff)
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
      }
    }
  }

  return {
    async start() {
      await tail.start()
      try {
        const me = await transport.getMe()
        log(`gateway online as @${me.username ?? me.first_name} (id=${me.id})`)
      } catch (err) {
        log(`gateway getMe failed: ${(err as Error).message}`)
      }
      loopPromise = runLoop()
    },
    async stop() {
      stopped = true
      internalController.abort()
      await tail.stop()
      if (loopPromise) await loopPromise.catch(() => {})
    },
  }
}
