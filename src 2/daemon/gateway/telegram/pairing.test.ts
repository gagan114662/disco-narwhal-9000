import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { addPairedChat, isChatPaired } from './allowlist.js'
import { writeTelegramConfig } from './config.js'
import {
  clearPendingPair,
  generatePairCode,
  readPendingPair,
  tryPair,
  writePendingPair,
} from './pairing.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makePaths(): { configPath: string; pendingPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tg-pair-'))
  TEMP_DIRS.push(dir)
  return {
    configPath: join(dir, 'telegram.json'),
    pendingPath: join(dir, 'telegram.pending.json'),
  }
}

describe('generatePairCode', () => {
  test('returns a 6-digit zero-padded string', () => {
    for (let i = 0; i < 20; i += 1) {
      const code = generatePairCode()
      expect(code).toMatch(/^\d{6}$/)
    }
  })
})

describe('pending pair file', () => {
  test('readPendingPair returns null when the file does not exist', async () => {
    const { pendingPath } = makePaths()
    expect(await readPendingPair(pendingPath)).toBeNull()
  })

  test('write + read round-trips', async () => {
    const { pendingPath } = makePaths()
    const now = new Date().toISOString()
    await writePendingPair({ code: '123456', createdAt: now }, pendingPath)
    expect(await readPendingPair(pendingPath)).toEqual({
      code: '123456',
      createdAt: now,
    })
  })
})

describe('allowlist', () => {
  test('addPairedChat throws if config does not exist yet', async () => {
    const { configPath } = makePaths()
    await expect(addPairedChat(42, configPath)).rejects.toThrow()
  })

  test('isChatPaired is false when config missing', async () => {
    const { configPath } = makePaths()
    expect(await isChatPaired(42, configPath)).toBe(false)
  })

  test('add then isPaired returns true; duplicate add is a no-op', async () => {
    const { configPath } = makePaths()
    await writeTelegramConfig({ token: 't', pairedChatIds: [] }, configPath)

    await addPairedChat(42, configPath)
    expect(await isChatPaired(42, configPath)).toBe(true)

    const second = await addPairedChat(42, configPath)
    expect(second.pairedChatIds).toEqual([42])
  })
})

describe('tryPair', () => {
  test('no_pending when no code file exists', async () => {
    const { configPath, pendingPath } = makePaths()
    await writeTelegramConfig({ token: 't', pairedChatIds: [] }, configPath)

    const result = await tryPair({
      chatId: 99,
      candidateCode: '123456',
      pendingPath,
      configPath,
    })

    expect(result).toEqual({ outcome: 'no_pending' })
    expect(await isChatPaired(99, configPath)).toBe(false)
  })

  test('mismatch when the DMed code does not match the pending one', async () => {
    const { configPath, pendingPath } = makePaths()
    await writeTelegramConfig({ token: 't', pairedChatIds: [] }, configPath)
    await writePendingPair(
      { code: '654321', createdAt: new Date().toISOString() },
      pendingPath,
    )

    const result = await tryPair({
      chatId: 99,
      candidateCode: '000000',
      pendingPath,
      configPath,
    })

    expect(result).toEqual({ outcome: 'mismatch' })
    expect(await isChatPaired(99, configPath)).toBe(false)
    // Pending code survives mismatches so the user can try again.
    expect(await readPendingPair(pendingPath)).not.toBeNull()
  })

  test('paired writes chat ID to allowlist and clears pending file', async () => {
    const { configPath, pendingPath } = makePaths()
    await writeTelegramConfig({ token: 't', pairedChatIds: [] }, configPath)
    await writePendingPair(
      { code: '424242', createdAt: new Date().toISOString() },
      pendingPath,
    )

    const result = await tryPair({
      chatId: 99,
      candidateCode: '  424242  ',
      pendingPath,
      configPath,
    })

    expect(result).toEqual({ outcome: 'paired', chatId: 99 })
    expect(await isChatPaired(99, configPath)).toBe(true)
    expect(existsSync(pendingPath)).toBe(false)
  })

  test('expired when the pending code is older than the TTL', async () => {
    const { configPath, pendingPath } = makePaths()
    await writeTelegramConfig({ token: 't', pairedChatIds: [] }, configPath)
    const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    await writePendingPair({ code: '111111', createdAt: oldTime }, pendingPath)

    const result = await tryPair({
      chatId: 99,
      candidateCode: '111111',
      pendingPath,
      configPath,
    })

    expect(result).toEqual({ outcome: 'expired' })
    expect(await isChatPaired(99, configPath)).toBe(false)
    expect(existsSync(pendingPath)).toBe(false)
  })

  test('clearPendingPair is idempotent', async () => {
    const { pendingPath } = makePaths()
    await clearPendingPair(pendingPath)
    await clearPendingPair(pendingPath)
  })
})
