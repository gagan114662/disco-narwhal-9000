import { createHash, createHmac } from 'crypto'
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

export type KairosAuditExportSignature =
  | {
      version: 1
      status: 'unsigned'
      reason: 'KAIROS_AUDIT_SIGNING_KEY not configured'
    }
  | {
      version: 1
      status: 'signed'
      algorithm: 'hmac-sha256'
      keyId: string
      signature: string
    }

export type KairosAuditExportSignatureVerification =
  | {
      valid: true
      status: 'unsigned'
      reason: string
    }
  | {
      valid: true
      status: 'signed'
      algorithm: 'hmac-sha256'
      keyId: string
    }
  | {
      valid: false
      reason:
        | 'missing signature'
        | 'unsupported signature status'
        | 'unsupported signature algorithm'
        | 'malformed signature'
        | 'signing key not configured'
        | 'key id mismatch'
        | 'signature mismatch'
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

export function calculateKairosBuildAuditMerkleRoot(
  auditHashes: string[],
): string | null {
  if (auditHashes.length === 0) {
    return null
  }

  let layer = auditHashes
  while (layer.length > 1) {
    const nextLayer: string[] = []
    for (let index = 0; index < layer.length; index += 2) {
      const left = layer[index] as string
      const right = layer[index + 1] ?? left
      nextLayer.push(calculateKairosAuditExportHash({ left, right }))
    }
    layer = nextLayer
  }
  return layer[0] ?? null
}

export function calculateKairosAuditExportEnvelopeHash(
  value: Record<string, unknown>,
): string {
  const {
    exportHash: _exportHash,
    auditSignature: _auditSignature,
    ...hashMaterial
  } = value
  return calculateKairosAuditExportHash(hashMaterial)
}

export function signKairosAuditExportHash(
  exportHash: string,
): KairosAuditExportSignature {
  const signingKey = process.env.KAIROS_AUDIT_SIGNING_KEY?.trim()
  if (!signingKey) {
    return {
      version: 1,
      status: 'unsigned',
      reason: 'KAIROS_AUDIT_SIGNING_KEY not configured',
    }
  }

  return {
    version: 1,
    status: 'signed',
    algorithm: 'hmac-sha256',
    keyId: process.env.KAIROS_AUDIT_SIGNING_KEY_ID?.trim() || 'local-env',
    signature: createHmac('sha256', signingKey).update(exportHash).digest('hex'),
  }
}

export function verifyKairosAuditExportSignature(
  exportHash: string,
  signature: unknown,
): KairosAuditExportSignatureVerification {
  if (signature === null || typeof signature !== 'object') {
    return { valid: false, reason: 'missing signature' }
  }

  const signatureRecord = signature as Record<string, unknown>
  if (signatureRecord.status === 'unsigned') {
    return {
      valid: true,
      status: 'unsigned',
      reason:
        typeof signatureRecord.reason === 'string'
          ? signatureRecord.reason
          : 'unsigned',
    }
  }
  if (signatureRecord.status !== 'signed') {
    return { valid: false, reason: 'unsupported signature status' }
  }
  if (signatureRecord.algorithm !== 'hmac-sha256') {
    return { valid: false, reason: 'unsupported signature algorithm' }
  }
  if (
    typeof signatureRecord.keyId !== 'string' ||
    typeof signatureRecord.signature !== 'string'
  ) {
    return { valid: false, reason: 'malformed signature' }
  }

  const signingKey = process.env.KAIROS_AUDIT_SIGNING_KEY?.trim()
  if (!signingKey) {
    return { valid: false, reason: 'signing key not configured' }
  }
  const expectedKeyId =
    process.env.KAIROS_AUDIT_SIGNING_KEY_ID?.trim() || 'local-env'
  if (signatureRecord.keyId !== expectedKeyId) {
    return { valid: false, reason: 'key id mismatch' }
  }

  const expectedSignature = createHmac('sha256', signingKey)
    .update(exportHash)
    .digest('hex')
  if (signatureRecord.signature !== expectedSignature) {
    return { valid: false, reason: 'signature mismatch' }
  }

  return {
    valid: true,
    status: 'signed',
    algorithm: 'hmac-sha256',
    keyId: signatureRecord.keyId,
  }
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
