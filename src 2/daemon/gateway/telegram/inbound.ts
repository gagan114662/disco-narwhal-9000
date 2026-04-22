// Inbound message handler used by both the long-poll loop and its tests.
//
// Given one Telegram update, this function decides what to do:
//
//   * group chat → silently ignore (DM-only policy)
//   * no text → ignore
//   * paired chat → dispatch command, reply with result
//   * unpaired chat → if a pending pair code matches, pair and reply
//                     "paired"; otherwise reply "this bot isn't yours"
//                     exactly once per chat ID, then go silent.

import { isChatPaired } from './allowlist.js'
import type { DispatchInput, DispatchResult } from './commands.js'
import { tryPair } from './pairing.js'
import type { TelegramMessage } from './transport.js'

export type InboundContext = {
  /** Paired-chat dispatcher (returns a reply). */
  dispatch: (input: DispatchInput) => Promise<DispatchResult>
  /** Chat IDs we've already sent the "bot isn't yours" reply to this run. */
  rejectedChatIds: Set<number>
  /** Paths are injected so tests can use tmp dirs. */
  pendingPath?: string
  configPath?: string
  now?: () => Date
}

export type InboundAction =
  | { kind: 'ignore'; reason: string }
  | { kind: 'reply'; chatId: number; text: string }
  | { kind: 'paired'; chatId: number; text: string }

export async function handleInboundMessage(
  message: TelegramMessage,
  ctx: InboundContext,
): Promise<InboundAction> {
  if (message.chat.type !== 'private') {
    return { kind: 'ignore', reason: 'non_private_chat' }
  }
  const text = message.text?.trim()
  if (!text) {
    return { kind: 'ignore', reason: 'no_text' }
  }

  const chatId = message.chat.id
  const paired = await isChatPaired(chatId, ctx.configPath)

  if (paired) {
    const { reply } = await ctx.dispatch({ chatId, text })
    return { kind: 'reply', chatId, text: reply }
  }

  // Unpaired path — try to pair first.
  const pair = await tryPair({
    chatId,
    candidateCode: text,
    now: ctx.now ? ctx.now() : undefined,
    pendingPath: ctx.pendingPath,
    configPath: ctx.configPath,
  })

  if (pair.outcome === 'paired') {
    return {
      kind: 'paired',
      chatId,
      text: 'Paired. You can now send /status, /pause, /resume, /remind, /skip.',
    }
  }

  // Deliberately quiet for mismatch + expired so a stranger guessing the
  // code doesn't get feedback on each try. The single allowed "bot isn't
  // yours" reply lives behind the rejected set.
  if (ctx.rejectedChatIds.has(chatId)) {
    return { kind: 'ignore', reason: 'already_rejected' }
  }
  ctx.rejectedChatIds.add(chatId)
  return {
    kind: 'reply',
    chatId,
    text:
      "This KAIROS bot is paired to another user's laptop — it's not yours to command. " +
      'Ignoring future messages.',
  }
}
