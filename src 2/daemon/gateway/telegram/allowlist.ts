// Paired chat-ID allowlist.
//
// Pairing writes a chat ID here; everything inbound consults
// isPaired() before acting. Keeping the allowlist in the same
// telegram.json as the token means unpair + token-rotation use the same
// atomic write, so there's no moment where the token is present but the
// allowlist is stale.

import { readTelegramConfig, writeTelegramConfig } from './config.js'
import type { TelegramConfig } from './config.js'

export async function isChatPaired(
  chatId: number,
  path?: string,
): Promise<boolean> {
  const config = await readTelegramConfig(path)
  if (!config) return false
  return config.pairedChatIds.includes(chatId)
}

export async function addPairedChat(
  chatId: number,
  path?: string,
): Promise<TelegramConfig> {
  const config = await readTelegramConfig(path)
  if (!config) {
    throw new Error('Cannot pair chat: telegram.json does not exist or has no token')
  }
  if (config.pairedChatIds.includes(chatId)) {
    return config
  }
  const next: TelegramConfig = {
    ...config,
    pairedChatIds: [...config.pairedChatIds, chatId],
  }
  await writeTelegramConfig(next, path)
  return next
}

export async function removePairedChat(
  chatId: number,
  path?: string,
): Promise<TelegramConfig | null> {
  const config = await readTelegramConfig(path)
  if (!config) return null
  if (!config.pairedChatIds.includes(chatId)) return config
  const next: TelegramConfig = {
    ...config,
    pairedChatIds: config.pairedChatIds.filter(id => id !== chatId),
  }
  await writeTelegramConfig(next, path)
  return next
}
