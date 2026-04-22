// Outbound message queue.
//
// Wraps the Telegram transport with two things the Bot API requires:
//
//   1. Chunking. The API rejects messages longer than 4096 chars. We
//      split at OUTBOUND_MAX_CHARS (under that limit so we have room for
//      a "(part N/M)" suffix if we ever add one; in v1 we just split).
//      Split prefers paragraph, then line, then hard-cut.
//
//   2. Per-chat rate limiting. Telegram's documented ceiling is 30 msg/sec
//      for the same chat. We model this with a token bucket per chat ID:
//      `tokens` starts at capacity; each send spends one; tokens refill
//      at `refillPerMs` based on wall-clock time. If a send would dip
//      below zero we sleep until enough tokens refill.
//
// The queue is serialized per chat — two concurrent callers for the same
// chat get ordered output — but chats run in parallel.

import type {
  SendMessageParams,
  TelegramMessage,
  TelegramTransport,
} from './transport.js'

export const OUTBOUND_MAX_CHARS = 4000
const DEFAULT_CAPACITY = 30
const DEFAULT_REFILL_MS = 1000
const DEFAULT_SLEEP = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms)
  })

export type OutboundQueueDeps = {
  transport: TelegramTransport
  capacity?: number
  refillMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export type OutboundQueue = {
  send(params: SendMessageParams): Promise<TelegramMessage[]>
  drain(): Promise<void>
}

type ChatState = {
  tokens: number
  lastRefillAt: number
  chain: Promise<void>
}

export function chunkMessage(
  text: string,
  maxChars = OUTBOUND_MAX_CHARS,
): string[] {
  if (text.length <= maxChars) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > maxChars) {
    let cutAt = -1
    // Prefer a clean paragraph break.
    const paragraph = remaining.lastIndexOf('\n\n', maxChars)
    if (paragraph > maxChars / 2) {
      cutAt = paragraph + 2
    } else {
      const line = remaining.lastIndexOf('\n', maxChars)
      if (line > maxChars / 2) {
        cutAt = line + 1
      }
    }
    if (cutAt <= 0) cutAt = maxChars
    chunks.push(remaining.slice(0, cutAt))
    remaining = remaining.slice(cutAt)
  }

  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

export function createOutboundQueue(deps: OutboundQueueDeps): OutboundQueue {
  const capacity = deps.capacity ?? DEFAULT_CAPACITY
  const refillMs = deps.refillMs ?? DEFAULT_REFILL_MS
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? DEFAULT_SLEEP
  const tokensPerMs = capacity / refillMs
  const chatStates = new Map<number, ChatState>()

  function refill(state: ChatState): void {
    const currentTime = now()
    const elapsed = currentTime - state.lastRefillAt
    if (elapsed <= 0) return
    const refilled = Math.min(capacity, state.tokens + elapsed * tokensPerMs)
    state.tokens = refilled
    state.lastRefillAt = currentTime
  }

  async function acquire(state: ChatState): Promise<void> {
    while (true) {
      refill(state)
      if (state.tokens >= 1) {
        state.tokens -= 1
        return
      }
      const needed = 1 - state.tokens
      const waitMs = Math.max(1, Math.ceil(needed / tokensPerMs))
      await sleep(waitMs)
    }
  }

  function getState(chatId: number): ChatState {
    let state = chatStates.get(chatId)
    if (!state) {
      state = { tokens: capacity, lastRefillAt: now(), chain: Promise.resolve() }
      chatStates.set(chatId, state)
    }
    return state
  }

  async function sendChunked(
    params: SendMessageParams,
  ): Promise<TelegramMessage[]> {
    const chunks = chunkMessage(params.text)
    const state = getState(params.chat_id)
    const results: TelegramMessage[] = []
    for (const chunk of chunks) {
      await acquire(state)
      const message = await deps.transport.sendMessage({
        ...params,
        text: chunk,
      })
      results.push(message)
    }
    return results
  }

  return {
    async send(params) {
      const state = getState(params.chat_id)
      let results: TelegramMessage[] = []
      const next = state.chain.then(async () => {
        results = await sendChunked(params)
      })
      // Swallow errors in the chain so one failure doesn't poison later sends.
      state.chain = next.catch(() => {})
      await next
      return results
    },
    async drain() {
      await Promise.all(Array.from(chatStates.values()).map(s => s.chain))
    },
  }
}
