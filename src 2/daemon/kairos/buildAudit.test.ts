import { describe, expect, test } from 'bun:test'
import {
  calculateKairosBuildEventAuditHash,
} from './buildAudit.js'
import type { KairosBuildEvent } from './buildState.js'

describe('KAIROS build audit hashing', () => {
  test('redacts clarifying question answers from audit hash material', () => {
    const event: KairosBuildEvent = {
      version: 1,
      kind: 'clarifying_question_answered',
      buildId: 'build-123',
      tenantId: 'tenant-local',
      t: '2026-04-25T20:12:00.000Z',
      questionNumber: 1,
      question: 'Who are the exact user roles and approvers?',
      answer: 'employee manager and HR approver',
      auditPrevHash: null,
    }

    expect(calculateKairosBuildEventAuditHash(event)).toBe(
      calculateKairosBuildEventAuditHash({
        ...event,
        answer: 'named employee alice@example.com',
      }),
    )
    expect(calculateKairosBuildEventAuditHash(event)).not.toBe(
      calculateKairosBuildEventAuditHash({
        ...event,
        questionNumber: 2,
      }),
    )
  })
})
