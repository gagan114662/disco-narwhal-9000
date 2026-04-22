import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeTelegramConfig } from './config.js'
import { handleInboundMessage } from './inbound.js'
import { writePendingPair } from './pairing.js'
import type { TelegramMessage } from './transport.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makePaths(): { configPath: string; pendingPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tg-inbound-'))
  TEMP_DIRS.push(dir)
  return {
    configPath: join(dir, 'telegram.json'),
    pendingPath: join(dir, 'telegram.pending.json'),
  }
}

function msg(partial: Partial<TelegramMessage> & { chatId?: number; text?: string; type?: 'private' | 'group' }): TelegramMessage {
  return {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: partial.chatId ?? 100, type: partial.type ?? 'private' },
    text: partial.text,
    ...partial,
  } as TelegramMessage
}

describe('handleInboundMessage', () => {
  test('ignores group chats', async () => {
    const { configPath, pendingPath } = makePaths()
    const result = await handleInboundMessage(msg({ type: 'group', text: '/status' }), {
      dispatch: async () => ({ reply: 'nope' }),
      rejectedChatIds: new Set(),
      configPath,
      pendingPath,
    })
    expect(result).toEqual({ kind: 'ignore', reason: 'non_private_chat' })
  })

  test('ignores empty/non-text messages', async () => {
    const { configPath, pendingPath } = makePaths()
    const result = await handleInboundMessage(msg({ text: '' }), {
      dispatch: async () => ({ reply: 'nope' }),
      rejectedChatIds: new Set(),
      configPath,
      pendingPath,
    })
    expect(result.kind).toBe('ignore')
  })

  test('paired chat dispatches the command and replies', async () => {
    const { configPath, pendingPath } = makePaths()
    await writeTelegramConfig({ token: 't', pairedChatIds: [100] }, configPath)

    const result = await handleInboundMessage(msg({ text: '/status' }), {
      dispatch: async () => ({ reply: 'daemon: idle' }),
      rejectedChatIds: new Set(),
      configPath,
      pendingPath,
    })

    expect(result).toEqual({ kind: 'reply', chatId: 100, text: 'daemon: idle' })
  })

  test('unpaired chat sending the correct code is paired', async () => {
    const { configPath, pendingPath } = makePaths()
    await writeTelegramConfig({ token: 't', pairedChatIds: [] }, configPath)
    await writePendingPair(
      { code: '424242', createdAt: new Date().toISOString() },
      pendingPath,
    )

    const result = await handleInboundMessage(msg({ chatId: 100, text: '424242' }), {
      dispatch: async () => ({ reply: 'should not be called' }),
      rejectedChatIds: new Set(),
      configPath,
      pendingPath,
    })

    expect(result.kind).toBe('paired')
  })

  test('unpaired chat with wrong/no code gets a single rejection reply', async () => {
    const { configPath, pendingPath } = makePaths()
    await writeTelegramConfig({ token: 't', pairedChatIds: [] }, configPath)

    const rejected = new Set<number>()

    const first = await handleInboundMessage(msg({ chatId: 100, text: 'hi' }), {
      dispatch: async () => ({ reply: 'nope' }),
      rejectedChatIds: rejected,
      configPath,
      pendingPath,
    })
    expect(first.kind).toBe('reply')
    if (first.kind === 'reply') {
      expect(first.text.toLowerCase()).toContain("not yours")
    }
    expect(rejected.has(100)).toBe(true)

    const second = await handleInboundMessage(msg({ chatId: 100, text: 'hello' }), {
      dispatch: async () => ({ reply: 'nope' }),
      rejectedChatIds: rejected,
      configPath,
      pendingPath,
    })
    expect(second).toEqual({ kind: 'ignore', reason: 'already_rejected' })
  })
})
