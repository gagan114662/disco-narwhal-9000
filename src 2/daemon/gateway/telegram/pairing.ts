// One-time pairing flow.
//
// Principle: a chat ID is only added to the allowlist if the user has
// independently run the `pair` CLI (which writes a 6-digit code to
// telegram.pending.json) AND then DMs that exact code to the bot. A
// stranger who DMs the bot with no active code is ignored (with one
// courtesy reply). A code expires after PENDING_TTL_MS so a forgotten
// terminal tab doesn't leave an open pairing window forever.

import { randomInt } from 'crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { addPairedChat } from './allowlist.js'
import { getTelegramPendingPairPath } from './paths.js'

const PENDING_TTL_MS = 15 * 60 * 1000
const CODE_DIGITS = 6

export type PendingPair = {
  code: string
  createdAt: string
}

export type PairingAttemptResult =
  | { outcome: 'paired'; chatId: number }
  | { outcome: 'no_pending' }
  | { outcome: 'expired' }
  | { outcome: 'mismatch' }

export function generatePairCode(): string {
  const n = randomInt(0, 10 ** CODE_DIGITS)
  return String(n).padStart(CODE_DIGITS, '0')
}

export async function writePendingPair(
  pending: PendingPair,
  path = getTelegramPendingPairPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp`
  await writeFile(tempPath, `${JSON.stringify(pending, null, 2)}\n`, 'utf8')
  await rename(tempPath, path)
}

export async function readPendingPair(
  path = getTelegramPendingPairPath(),
): Promise<PendingPair | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PendingPair>
    if (typeof parsed.code !== 'string' || typeof parsed.createdAt !== 'string') {
      return null
    }
    return { code: parsed.code, createdAt: parsed.createdAt }
  } catch {
    return null
  }
}

export async function clearPendingPair(
  path = getTelegramPendingPairPath(),
): Promise<void> {
  await unlink(path).catch(() => {})
}

/**
 * Consult a pending-pair file, decide whether a DMed code should move a
 * chat ID into the allowlist, and on success clear the pending file so
 * the code can't be reused. Written as a pure-ish function so tests can
 * inject the pending-file path and now() and inspect the returned
 * outcome enum.
 */
export async function tryPair(params: {
  chatId: number
  candidateCode: string
  now?: Date
  pendingPath?: string
  configPath?: string
}): Promise<PairingAttemptResult> {
  const now = params.now ?? new Date()
  const pending = await readPendingPair(params.pendingPath)
  if (!pending) return { outcome: 'no_pending' }

  const createdAt = Date.parse(pending.createdAt)
  if (!Number.isFinite(createdAt)) {
    await clearPendingPair(params.pendingPath)
    return { outcome: 'expired' }
  }
  if (now.getTime() - createdAt > PENDING_TTL_MS) {
    await clearPendingPair(params.pendingPath)
    return { outcome: 'expired' }
  }

  if (params.candidateCode.trim() !== pending.code) {
    return { outcome: 'mismatch' }
  }

  await addPairedChat(params.chatId, params.configPath)
  await clearPendingPair(params.pendingPath)
  return { outcome: 'paired', chatId: params.chatId }
}
