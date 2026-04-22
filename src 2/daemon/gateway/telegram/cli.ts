// CLI-side helpers for /kairos gateway telegram *. These run in the user's
// interactive shell, not the daemon. They only touch the on-disk config
// and pending-code files; the running daemon picks up changes on the
// next inbound message.

import { readTelegramConfig, writeTelegramConfig } from './config.js'
import { getTelegramConfigPath } from './paths.js'
import {
  clearPendingPair,
  generatePairCode,
  writePendingPair,
} from './pairing.js'
import { removePairedChat } from './allowlist.js'
import { createTelegramTransport } from './transport.js'

const BOT_TOKEN_REGEX = /^\d{5,}:[A-Za-z0-9_-]{20,}$/

export type SetupResult = {
  ok: true
  botUsername?: string
} | {
  ok: false
  reason: string
}

/**
 * Validate a token, hit the Bot API to resolve the username, and write
 * ~/.claude/kairos/telegram.json (0600). Safe to re-run — rotating the
 * token preserves the paired chat IDs.
 */
export async function setupTelegram(
  token: string,
  opts: { fetcher?: typeof fetch; configPath?: string } = {},
): Promise<SetupResult> {
  const trimmed = token.trim()
  if (!BOT_TOKEN_REGEX.test(trimmed)) {
    return {
      ok: false,
      reason:
        'That does not look like a Telegram bot token. Expected format: `1234567:ABCDEF...` from @BotFather.',
    }
  }

  let botUsername: string | undefined
  try {
    const transport = createTelegramTransport(trimmed, { fetcher: opts.fetcher })
    const me = await transport.getMe()
    botUsername = me.username
  } catch (err) {
    return {
      ok: false,
      reason: `Could not reach Telegram with that token: ${(err as Error).message}`,
    }
  }

  const existing = await readTelegramConfig(opts.configPath)
  await writeTelegramConfig(
    {
      token: trimmed,
      botUsername,
      pairedChatIds: existing?.pairedChatIds ?? [],
    },
    opts.configPath,
  )
  return { ok: true, botUsername }
}

export type PairResult =
  | {
      ok: true
      code: string
      botUsername?: string
    }
  | { ok: false; reason: string }

/**
 * Generate a 6-digit pair code and write it to telegram.pending.json.
 * The daemon's inbound loop will match it to the next DM from a chat
 * and pair that chat ID. Returns the code so the CLI can print it.
 */
export async function startPairing(
  opts: { configPath?: string; pendingPath?: string; now?: Date } = {},
): Promise<PairResult> {
  const config = await readTelegramConfig(opts.configPath)
  if (!config) {
    return {
      ok: false,
      reason:
        'Run `/kairos gateway telegram setup <bot-token>` first — no token is configured.',
    }
  }
  const code = generatePairCode()
  const createdAt = (opts.now ?? new Date()).toISOString()
  await writePendingPair({ code, createdAt }, opts.pendingPath)
  return { ok: true, code, botUsername: config.botUsername }
}

export type StatusResult = {
  configured: boolean
  botUsername?: string
  pairedChatIds: number[]
  configPath: string
}

export async function readGatewayStatus(opts: { configPath?: string } = {}): Promise<StatusResult> {
  const config = await readTelegramConfig(opts.configPath)
  const configPath = opts.configPath ?? getTelegramConfigPath()
  if (!config) {
    return { configured: false, pairedChatIds: [], configPath }
  }
  return {
    configured: true,
    botUsername: config.botUsername,
    pairedChatIds: [...config.pairedChatIds],
    configPath,
  }
}

export type UnpairResult =
  | { ok: true; removed: number[]; remaining: number[] }
  | { ok: false; reason: string }

export async function unpairTelegram(
  target: 'all' | number,
  opts: { configPath?: string; pendingPath?: string } = {},
): Promise<UnpairResult> {
  const config = await readTelegramConfig(opts.configPath)
  if (!config) return { ok: false, reason: 'No telegram.json to unpair from.' }

  if (target === 'all') {
    const removed = [...config.pairedChatIds]
    await writeTelegramConfig(
      { ...config, pairedChatIds: [] },
      opts.configPath,
    )
    await clearPendingPair(opts.pendingPath)
    return { ok: true, removed, remaining: [] }
  }

  if (!config.pairedChatIds.includes(target)) {
    return { ok: false, reason: `chat id ${target} is not paired.` }
  }
  const next = await removePairedChat(target, opts.configPath)
  return {
    ok: true,
    removed: [target],
    remaining: next?.pairedChatIds ?? [],
  }
}
