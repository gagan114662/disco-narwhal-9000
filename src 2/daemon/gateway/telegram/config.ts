// Read/write ~/.claude/kairos/telegram.json.
//
// Stores the bot token and the allowlist of paired chat IDs. The file is
// written with mode 0600 so a shared machine doesn't leak the token. We
// read the file on every check because the CLI can mutate it while the
// daemon is running (pair / unpair) and the in-memory cost of a stat +
// readFile per message is negligible.

import { chmod, mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { getTelegramConfigPath } from './paths.js'

export type TelegramConfig = {
  token: string
  botUsername?: string
  pairedChatIds: number[]
}

const MODE_0600 = 0o600

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function normalizeConfig(raw: unknown): TelegramConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const token = record.token
  if (typeof token !== 'string' || token.trim().length === 0) return null
  const chatIdsRaw = Array.isArray(record.pairedChatIds) ? record.pairedChatIds : []
  const pairedChatIds = chatIdsRaw.filter(isPositiveInt)
  const botUsername =
    typeof record.botUsername === 'string' && record.botUsername.length > 0
      ? record.botUsername
      : undefined
  return { token, botUsername, pairedChatIds }
}

export async function readTelegramConfig(
  path = getTelegramConfigPath(),
): Promise<TelegramConfig | null> {
  try {
    const raw = await readFile(path, 'utf8')
    return normalizeConfig(JSON.parse(raw))
  } catch {
    return null
  }
}

/**
 * Atomically write the config with mode 0600. We `rename` over the final
 * path so a concurrent reader never sees a half-written file, and `chmod`
 * the temp file before rename so the permission bits are correct the
 * instant the real file appears.
 */
export async function writeTelegramConfig(
  config: TelegramConfig,
  path = getTelegramConfigPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp`
  await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: MODE_0600,
  })
  await chmod(tempPath, MODE_0600)
  await rename(tempPath, path)
}
