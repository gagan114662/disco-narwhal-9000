import { describe, expect, test } from 'bun:test'
import {
  OUTBOUND_MAX_CHARS,
  chunkMessage,
  createOutboundQueue,
} from './outbound.js'
import type {
  SendMessageParams,
  TelegramMessage,
  TelegramTransport,
} from './transport.js'

function stubTransport(
  calls: SendMessageParams[] = [],
  delayMs = 0,
): { transport: TelegramTransport; calls: SendMessageParams[] } {
  const transport: TelegramTransport = {
    getMe: async () => ({ id: 1, is_bot: true, first_name: 'bot' }),
    getUpdates: async () => [],
    sendMessage: async params => {
      calls.push(params)
      if (delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs))
      }
      return {
        message_id: calls.length,
        date: Math.floor(Date.now() / 1000),
        chat: { id: params.chat_id, type: 'private' },
        text: params.text,
      } satisfies TelegramMessage
    },
  }
  return { transport, calls }
}

describe('chunkMessage', () => {
  test('returns a single element when the text fits', () => {
    expect(chunkMessage('hello')).toEqual(['hello'])
  })

  test('splits on paragraph boundary when possible', () => {
    const big = `${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}`
    const chunks = chunkMessage(big)

    expect(chunks.length).toBe(2)
    expect(chunks[0]).toBe(`${'a'.repeat(3000)}\n\n`)
    expect(chunks[1]).toBe('b'.repeat(3000))
    expect(chunks[0].length).toBeLessThanOrEqual(OUTBOUND_MAX_CHARS)
  })

  test('splits on line boundary when no paragraph break fits', () => {
    const lineA = 'a'.repeat(3000)
    const lineB = 'b'.repeat(3000)
    const big = `${lineA}\n${lineB}`
    const chunks = chunkMessage(big)

    expect(chunks.length).toBe(2)
    expect(chunks[0]).toBe(`${lineA}\n`)
    expect(chunks[1]).toBe(lineB)
  })

  test('hard-cuts when no boundary is available', () => {
    const big = 'x'.repeat(OUTBOUND_MAX_CHARS * 2 + 5)
    const chunks = chunkMessage(big)

    expect(chunks.length).toBe(3)
    expect(chunks[0].length).toBe(OUTBOUND_MAX_CHARS)
    expect(chunks[1].length).toBe(OUTBOUND_MAX_CHARS)
    expect(chunks[2].length).toBe(5)
  })
})

describe('outbound queue', () => {
  test('sends a short message as a single API call', async () => {
    const { transport, calls } = stubTransport()
    const queue = createOutboundQueue({ transport })

    const results = await queue.send({ chat_id: 1, text: 'hi' })

    expect(calls.length).toBe(1)
    expect(calls[0].text).toBe('hi')
    expect(results.length).toBe(1)
  })

  test('splits a long message into chunks, each sent in order', async () => {
    const { transport, calls } = stubTransport()
    const queue = createOutboundQueue({ transport })

    const big = `${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}`
    await queue.send({ chat_id: 1, text: big })

    expect(calls.length).toBe(2)
    expect(calls[0].text.startsWith('a')).toBe(true)
    expect(calls[1].text.startsWith('b')).toBe(true)
  })

  test('serializes concurrent sends to the same chat', async () => {
    const { transport, calls } = stubTransport([], 10)
    const queue = createOutboundQueue({ transport })

    await Promise.all([
      queue.send({ chat_id: 1, text: 'first' }),
      queue.send({ chat_id: 1, text: 'second' }),
    ])

    expect(calls.map(c => c.text)).toEqual(['first', 'second'])
  })

  test('rate-limiter forces a sleep when the token bucket empties', async () => {
    const { transport } = stubTransport()
    let fakeNow = 0
    const sleeps: number[] = []
    const queue = createOutboundQueue({
      transport,
      capacity: 2,
      refillMs: 1000,
      now: () => fakeNow,
      sleep: async ms => {
        sleeps.push(ms)
        fakeNow += ms
      },
    })

    // Burn through the bucket with 3 back-to-back sends.
    await queue.send({ chat_id: 1, text: 'a' })
    await queue.send({ chat_id: 1, text: 'b' })
    await queue.send({ chat_id: 1, text: 'c' })

    expect(sleeps.length).toBeGreaterThanOrEqual(1)
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
  })

  test('different chats use independent buckets', async () => {
    const { transport } = stubTransport()
    let fakeNow = 0
    const sleeps: number[] = []
    const queue = createOutboundQueue({
      transport,
      capacity: 1,
      refillMs: 1000,
      now: () => fakeNow,
      sleep: async ms => {
        sleeps.push(ms)
        fakeNow += ms
      },
    })

    // Each chat has 1 token — two sends across two chats should NOT sleep.
    await queue.send({ chat_id: 1, text: 'a' })
    await queue.send({ chat_id: 2, text: 'b' })

    expect(sleeps.length).toBe(0)
  })
})
