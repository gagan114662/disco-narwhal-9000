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

  test('redacts filesystem paths from audit hash material', () => {
    const specEvent: KairosBuildEvent = {
      version: 1,
      kind: 'spec_written',
      buildId: 'build-123',
      tenantId: 'tenant-local',
      t: '2026-04-25T20:12:00.000Z',
      specPath: '/Users/alice/customer-one/.claude/kairos/builds/build-123/spec.md',
      auditPrevHash: null,
    }
    const resultEvent: KairosBuildEvent = {
      version: 1,
      kind: 'build_result_written',
      buildId: 'build-123',
      tenantId: 'tenant-local',
      t: '2026-04-25T20:13:00.000Z',
      status: 'succeeded',
      resultPath:
        '/Users/alice/customer-one/.claude/kairos/builds/build-123/result.json',
      auditPrevHash: 'previous-hash',
    }

    expect(calculateKairosBuildEventAuditHash(specEvent)).toBe(
      calculateKairosBuildEventAuditHash({
        ...specEvent,
        specPath:
          '/Users/bob/customer-two/.claude/kairos/builds/build-123/spec.md',
      }),
    )
    expect(calculateKairosBuildEventAuditHash(resultEvent)).toBe(
      calculateKairosBuildEventAuditHash({
        ...resultEvent,
        resultPath:
          '/Users/bob/customer-two/.claude/kairos/builds/build-123/result.json',
      }),
    )
    expect(calculateKairosBuildEventAuditHash(specEvent)).not.toBe(
      calculateKairosBuildEventAuditHash({
        ...specEvent,
        kind: 'build_result_written',
        status: 'succeeded',
        resultPath:
          '/Users/alice/customer-one/.claude/kairos/builds/build-123/result.json',
      }),
    )
  })

  test('redacts build failure messages from audit hash material', () => {
    const event: KairosBuildEvent = {
      version: 1,
      kind: 'build_failed',
      buildId: 'build-123',
      tenantId: 'tenant-local',
      t: '2026-04-25T20:14:00.000Z',
      errorMessage:
        'failed reading /Users/alice/customer-one/secrets.txt for jane@example.com',
      auditPrevHash: 'previous-hash',
    }

    expect(calculateKairosBuildEventAuditHash(event)).toBe(
      calculateKairosBuildEventAuditHash({
        ...event,
        errorMessage:
          'failed reading /Users/bob/customer-two/secrets.txt for bob@example.com',
      }),
    )
    expect(calculateKairosBuildEventAuditHash(event)).not.toBe(
      calculateKairosBuildEventAuditHash({
        ...event,
        kind: 'build_created',
        status: 'failed',
      }),
    )
  })
})
