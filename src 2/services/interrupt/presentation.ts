import type {
  ContentBlockParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import { extractTextContent } from '../../utils/messages.js'

export type CancelAcknowledgementScope = 'request' | 'tool'

type QueuePresentationSource = {
  mode?: string
  isMeta?: boolean
  origin?: { kind: string } | undefined
}

const QUEUED_PREVIEW_LIMIT = 60

export function getCancelAcknowledgementLabel(
  scope: CancelAcknowledgementScope,
): string {
  return scope === 'tool' ? 'Interrupted tool run' : 'Interrupted response'
}

export function getCancelFollowUpLabel(): string {
  return 'What should Claude do instead?'
}

export function shouldShowQueuedMessageBadge(
  command: QueuePresentationSource,
): boolean {
  return command.mode === 'prompt' && !command.isMeta && command.origin === undefined
}

export function shouldShowRedirectedMarker(
  attachment: QueuePresentationSource,
): boolean {
  return (
    attachment.mode === 'prompt' &&
    !attachment.isMeta &&
    attachment.origin === undefined
  )
}

export function getQueuedMessageBadgeLabel(text: string): string {
  return `queued: ${truncateForBadge(text, QUEUED_PREVIEW_LIMIT)}`
}

export function formatQueuedPreviewContent(
  value: string | ContentBlockParam[],
  command: QueuePresentationSource,
): string | ContentBlockParam[] {
  if (!shouldShowQueuedMessageBadge(command)) {
    return value
  }

  if (typeof value === 'string') {
    return getQueuedMessageBadgeLabel(value)
  }

  const prefixed = value.map((block, index) => {
    if (index !== 0 || block.type !== 'text') {
      return block
    }
    return {
      ...block,
      text: getQueuedMessageBadgeLabel(block.text),
    } satisfies TextBlockParam
  })

  if (prefixed[0]?.type === 'text') {
    return prefixed
  }

  return [
    {
      type: 'text',
      text: getQueuedMessageBadgeLabel(''),
    },
    ...prefixed,
  ]
}

export function getRedirectedMarkerLabel(): string {
  return '-> redirected'
}

export function extractQueuedCommandText(
  value: string | ContentBlockParam[],
): string {
  return typeof value === 'string' ? value : extractTextContent(value, '\n')
}

function truncateForBadge(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return '(empty)'
  }
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, limit - 3)}...`
}
