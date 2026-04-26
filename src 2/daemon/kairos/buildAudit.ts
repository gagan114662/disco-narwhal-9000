import { createHash } from 'crypto'
import { jsonStringify } from '../../utils/slowOperations.js'
import type { KairosBuildEvent } from './buildState.js'

export type KairosBuildAuditVerification =
  | {
      valid: true
      eventCount: number
      lastHash: string | null
    }
  | {
      valid: false
      eventNumber: number
      reason: 'missing hash' | 'prev hash mismatch' | 'hash mismatch'
      expected?: string | null
      actual?: string | null
    }

function sortForAuditHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForAuditHash)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortForAuditHash(entryValue)]),
    )
  }
  return value
}

function redactBuildEventAuditPayload(event: KairosBuildEvent): KairosBuildEvent {
  switch (event.kind) {
    case 'clarifying_question_answered':
      return {
        ...event,
        answer: '[redacted]',
      }
    case 'spec_written':
      return {
        ...event,
        specPath: '[redacted]',
      }
    case 'build_result_written':
      return {
        ...event,
        resultPath: '[redacted]',
      }
    case 'build_failed':
      return {
        ...event,
        errorMessage: '[redacted]',
      }
    default:
      return event
  }
}

export function calculateKairosBuildEventAuditHash(
  event: KairosBuildEvent,
): string {
  const redactedEvent = redactBuildEventAuditPayload(event)
  const { auditHash: _auditHash, ...eventWithoutHash } = redactedEvent
  return createHash('sha256')
    .update(jsonStringify(sortForAuditHash(eventWithoutHash)))
    .digest('hex')
}

export function calculateKairosAuditExportHash(value: unknown): string {
  return createHash('sha256')
    .update(jsonStringify(sortForAuditHash(value)))
    .digest('hex')
}

export function verifyKairosBuildEventAuditChain(
  events: KairosBuildEvent[],
): KairosBuildAuditVerification {
  let previousHash: string | null = null
  for (const [index, event] of events.entries()) {
    const eventNumber = index + 1
    if (!event.auditHash) {
      return {
        valid: false,
        eventNumber,
        reason: 'missing hash',
        expected: calculateKairosBuildEventAuditHash({
          ...event,
          auditPrevHash: previousHash,
        }),
        actual: null,
      }
    }
    if ((event.auditPrevHash ?? null) !== previousHash) {
      return {
        valid: false,
        eventNumber,
        reason: 'prev hash mismatch',
        expected: previousHash,
        actual: event.auditPrevHash ?? null,
      }
    }
    const expectedHash = calculateKairosBuildEventAuditHash(event)
    if (event.auditHash !== expectedHash) {
      return {
        valid: false,
        eventNumber,
        reason: 'hash mismatch',
        expected: expectedHash,
        actual: event.auditHash,
      }
    }
    previousHash = event.auditHash
  }
  return {
    valid: true,
    eventCount: events.length,
    lastHash: previousHash,
  }
}
