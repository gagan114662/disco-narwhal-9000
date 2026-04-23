import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import type { Attachment } from '../../utils/attachments.js'

export type PendingSkillDiscoveryPrefetch = Promise<Attachment[]>

export function startSkillDiscoveryPrefetch(
  _input: string | null,
  _messages: Message[],
  _context: ToolUseContext,
): PendingSkillDiscoveryPrefetch {
  return Promise.resolve([])
}

export async function collectSkillDiscoveryPrefetch(
  pending: PendingSkillDiscoveryPrefetch,
): Promise<Attachment[]> {
  return pending
}

export async function getTurnZeroSkillDiscovery(
  _input: string,
  _messages: Message[],
  _context: ToolUseContext,
): Promise<Attachment[]> {
  return []
}
