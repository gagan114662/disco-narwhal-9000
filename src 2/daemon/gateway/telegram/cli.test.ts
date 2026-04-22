import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  readGatewayStatus,
  setupTelegram,
  startPairing,
  unpairTelegram,
} from './cli.js'
import { writeTelegramConfig } from './config.js'

const TEMP_DIRS: string[] = []
afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makePaths() {
  const dir = mkdtempSync(join(tmpdir(), 'tg-cli-'))
  TEMP_DIRS.push(dir)
  return {
    configPath: join(dir, 'telegram.json'),
    pendingPath: join(dir, 'telegram.pending.json'),
  }
}

function okFetcher(me: Record<string, unknown>): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ ok: true, result: me }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
}

describe('setupTelegram', () => {
  test('rejects an obviously malformed token without hitting the API', async () => {
    const { configPath } = makePaths()
    const result = await setupTelegram('not-a-token', { configPath })
    expect(result.ok).toBe(false)
  })

  test('writes the config (0600) and captures the bot username', async () => {
    const { configPath } = makePaths()
    const result = await setupTelegram('1234567:AAAAAAAAAAAAAAAAAAAAAA', {
      configPath,
      fetcher: okFetcher({ id: 1, is_bot: true, first_name: 'bot', username: 'magnus' }),
    })
    expect(result).toEqual({ ok: true, botUsername: 'magnus' })

    const status = await readGatewayStatus({ configPath })
    expect(status.configured).toBe(true)
    expect(status.botUsername).toBe('magnus')
  })

  test('re-running setup preserves paired chat IDs', async () => {
    const { configPath } = makePaths()
    await writeTelegramConfig(
      { token: 'old', pairedChatIds: [42] },
      configPath,
    )
    const result = await setupTelegram('1234567:AAAAAAAAAAAAAAAAAAAAAA', {
      configPath,
      fetcher: okFetcher({ id: 1, is_bot: true, first_name: 'bot', username: 'magnus' }),
    })
    expect(result.ok).toBe(true)

    const status = await readGatewayStatus({ configPath })
    expect(status.pairedChatIds).toEqual([42])
  })
})

describe('startPairing', () => {
  test('fails when no config exists (user must setup first)', async () => {
    const { configPath, pendingPath } = makePaths()
    const result = await startPairing({ configPath, pendingPath })
    expect(result.ok).toBe(false)
  })

  test('writes a 6-digit pending code', async () => {
    const { configPath, pendingPath } = makePaths()
    await writeTelegramConfig(
      { token: 't', botUsername: 'magnus', pairedChatIds: [] },
      configPath,
    )
    const result = await startPairing({ configPath, pendingPath })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.code).toMatch(/^\d{6}$/)
    expect(result.botUsername).toBe('magnus')
  })
})

describe('readGatewayStatus', () => {
  test('reports unconfigured when file missing', async () => {
    const { configPath } = makePaths()
    const s = await readGatewayStatus({ configPath })
    expect(s.configured).toBe(false)
    expect(s.pairedChatIds).toEqual([])
  })
})

describe('unpairTelegram', () => {
  test('unpair all clears the allowlist and pending code', async () => {
    const { configPath, pendingPath } = makePaths()
    await writeTelegramConfig(
      { token: 't', pairedChatIds: [1, 2, 3] },
      configPath,
    )
    const r = await unpairTelegram('all', { configPath, pendingPath })
    expect(r).toEqual({ ok: true, removed: [1, 2, 3], remaining: [] })
  })

  test('unpair single chat leaves the rest alone', async () => {
    const { configPath } = makePaths()
    await writeTelegramConfig(
      { token: 't', pairedChatIds: [1, 2, 3] },
      configPath,
    )
    const r = await unpairTelegram(2, { configPath })
    expect(r).toEqual({ ok: true, removed: [2], remaining: [1, 3] })
  })

  test('unpair rejects unknown chat id', async () => {
    const { configPath } = makePaths()
    await writeTelegramConfig({ token: 't', pairedChatIds: [1] }, configPath)
    const r = await unpairTelegram(99, { configPath })
    expect(r.ok).toBe(false)
  })
})
