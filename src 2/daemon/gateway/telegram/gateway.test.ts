import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeTelegramConfig } from './config.js'
import { createGateway } from './gateway.js'
import type { OutboundQueue } from './outbound.js'
import {
  TelegramTransportError,
  type SendMessageParams,
  type TelegramMessage,
  type TelegramTransport,
  type TelegramUpdate,
} from './transport.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makePaths() {
  const dir = mkdtempSync(join(tmpdir(), 'tg-gw-'))
  TEMP_DIRS.push(dir)
  const eventPath = join(dir, 'events.jsonl')
  writeFileSync(eventPath, '')
  return {
    configPath: join(dir, 'telegram.json'),
    pendingPath: join(dir, 'telegram.pending.json'),
    eventPath,
  }
}

type ProgrammedUpdate = TelegramUpdate | { throw: Error }

function stubTransport(
  queue: ProgrammedUpdate[][],
  abortSignal?: AbortSignal,
): {
  transport: TelegramTransport
  sends: SendMessageParams[]
} {
  const sends: SendMessageParams[] = []
  let idx = 0
  const transport: TelegramTransport = {
    getMe: async () => ({ id: 1, is_bot: true, first_name: 'bot' }),
    getUpdates: async () => {
      const batch = queue[idx]
      idx += 1
      if (!batch) {
        // Park until aborted so the loop can be stopped deterministically.
        await new Promise<void>((_, reject) => {
          if (abortSignal?.aborted) reject(new Error('aborted'))
          abortSignal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        })
        return []
      }
      const first = batch[0]
      if (first && 'throw' in first) {
        throw first.throw
      }
      return batch as TelegramUpdate[]
    },
    sendMessage: async params => {
      sends.push(params)
      return {
        message_id: sends.length,
        date: Math.floor(Date.now() / 1000),
        chat: { id: params.chat_id, type: 'private' },
        text: params.text,
      } satisfies TelegramMessage
    },
  }
  return { transport, sends }
}

function stubOutbound(transport: TelegramTransport): OutboundQueue {
  return {
    send: async params => {
      const m = await transport.sendMessage(params)
      return [m]
    },
    drain: async () => {},
  }
}

function makeUpdate(
  update_id: number,
  chatId: number,
  text: string,
): TelegramUpdate {
  return {
    update_id,
    message: {
      message_id: update_id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' },
      text,
    },
  }
}

describe('createGateway', () => {
  test('paired chat gets a dispatched reply', async () => {
    const { configPath, pendingPath, eventPath } = makePaths()
    await writeTelegramConfig({ token: 't', pairedChatIds: [500] }, configPath)

    const controller = new AbortController()
    const { transport, sends } = stubTransport(
      [[makeUpdate(1, 500, '/status')]],
      controller.signal,
    )
    const outbound = stubOutbound(transport)

    const gateway = createGateway({
      token: 't',
      configPath,
      pendingPath,
      eventPath,
      dispatch: async () => ({ reply: 'daemon: idle' }),
      transport,
      outbound,
      sleep: async () => {},
      signal: controller.signal,
    })
    await gateway.start()
    await new Promise(r => setTimeout(r, 50))
    controller.abort()
    await gateway.stop()

    expect(sends.length).toBe(1)
    expect(sends[0]).toEqual({ chat_id: 500, text: 'daemon: idle' })
  })

  test('unpaired chat gets a single rejection reply; subsequent messages are silent', async () => {
    const { configPath, pendingPath, eventPath } = makePaths()
    await writeTelegramConfig({ token: 't', pairedChatIds: [] }, configPath)

    const controller = new AbortController()
    const { transport, sends } = stubTransport(
      [[makeUpdate(1, 777, 'hi'), makeUpdate(2, 777, 'anyone home?')]],
      controller.signal,
    )
    const outbound = stubOutbound(transport)

    const gateway = createGateway({
      token: 't',
      configPath,
      pendingPath,
      eventPath,
      dispatch: async () => ({ reply: 'n/a' }),
      transport,
      outbound,
      sleep: async () => {},
      signal: controller.signal,
    })
    await gateway.start()
    await new Promise(r => setTimeout(r, 50))
    controller.abort()
    await gateway.stop()

    expect(sends.length).toBe(1)
    expect(sends[0].text.toLowerCase()).toContain('not yours')
  })

  test('group chats are silently ignored', async () => {
    const { configPath, pendingPath, eventPath } = makePaths()
    await writeTelegramConfig({ token: 't', pairedChatIds: [123] }, configPath)

    const controller = new AbortController()
    const { transport, sends } = stubTransport(
      [
        [
          {
            update_id: 1,
            message: {
              message_id: 1,
              date: 0,
              chat: { id: 123, type: 'group' },
              text: '/status',
            },
          },
        ],
      ],
      controller.signal,
    )
    const outbound = stubOutbound(transport)

    const gateway = createGateway({
      token: 't',
      configPath,
      pendingPath,
      eventPath,
      dispatch: async () => ({ reply: 'daemon: idle' }),
      transport,
      outbound,
      sleep: async () => {},
      signal: controller.signal,
    })
    await gateway.start()
    await new Promise(r => setTimeout(r, 50))
    controller.abort()
    await gateway.stop()

    expect(sends.length).toBe(0)
  })

  test('network error triggers exponential backoff but the loop continues', async () => {
    const { configPath, pendingPath, eventPath } = makePaths()
    await writeTelegramConfig({ token: 't', pairedChatIds: [888] }, configPath)

    const controller = new AbortController()
    const { transport, sends } = stubTransport(
      [
        [{ throw: new TelegramTransportError('boom') }],
        [makeUpdate(10, 888, '/status')],
      ],
      controller.signal,
    )
    const outbound = stubOutbound(transport)
    const sleeps: number[] = []

    const gateway = createGateway({
      token: 't',
      configPath,
      pendingPath,
      eventPath,
      dispatch: async () => ({ reply: 'ok' }),
      transport,
      outbound,
      sleep: async ms => {
        sleeps.push(ms)
      },
      signal: controller.signal,
    })
    await gateway.start()
    await new Promise(r => setTimeout(r, 50))
    controller.abort()
    await gateway.stop()

    expect(sleeps.length).toBeGreaterThan(0)
    expect(sends.some(s => s.chat_id === 888)).toBe(true)
  })

  test('update_id advances so the same update is never replayed', async () => {
    const { configPath, pendingPath, eventPath } = makePaths()
    await writeTelegramConfig({ token: 't', pairedChatIds: [1] }, configPath)

    const controller = new AbortController()
    const offsets: (number | undefined)[] = []
    const transport: TelegramTransport = {
      getMe: async () => ({ id: 1, is_bot: true, first_name: 'bot' }),
      getUpdates: async params => {
        offsets.push(params.offset)
        if (offsets.length === 1) {
          return [makeUpdate(50, 1, '/status')]
        }
        await new Promise<void>((_, reject) => {
          if (controller.signal.aborted) reject(new Error('aborted'))
          controller.signal.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          )
        })
        return []
      },
      sendMessage: async () =>
        ({
          message_id: 1,
          date: 0,
          chat: { id: 1, type: 'private' },
        }) as TelegramMessage,
    }
    const outbound = stubOutbound(transport)

    const gateway = createGateway({
      token: 't',
      configPath,
      pendingPath,
      eventPath,
      dispatch: async () => ({ reply: 'ok' }),
      transport,
      outbound,
      sleep: async () => {},
      signal: controller.signal,
    })
    await gateway.start()
    await new Promise(r => setTimeout(r, 50))
    controller.abort()
    await gateway.stop()

    expect(offsets[0]).toBe(0)
    expect(offsets[1]).toBe(51)
  })
})
