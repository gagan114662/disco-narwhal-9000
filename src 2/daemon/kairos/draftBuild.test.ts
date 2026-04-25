import { describe, expect, test } from 'bun:test'
import {
  createDraftAcceptanceChecks,
  createDraftClarifyingQuestions,
  createDraftFunctionalRequirements,
  createDraftTracerSlices,
  deriveDraftTitle,
  renderDraftPrd,
} from './draftBuild.js'

describe('draft build PRD rendering', () => {
  test('derives a concise title from a vague brief', () => {
    expect(
      deriveDraftTitle(
        'please build an internal leave request approval app for hourly workers',
      ),
    ).toBe('Internal Leave Request Approval App')

    expect(deriveDraftTitle('   vendor onboarding form   ')).toBe(
      'Vendor Onboarding Form',
    )
  })

  test('renders the original brief as quoted source input and anchors next steps', () => {
    const prd = renderDraftPrd(
      'please build an internal leave request approval app for hourly workers',
    )

    expect(prd).toContain('# Internal Leave Request Approval App')
    expect(prd).toContain('**Status:** Draft')
    expect(prd).toContain('> please build an internal leave request approval app for hourly workers')
    expect(prd).toContain('## Clarifying Questions')
    expect(prd).toContain('## Acceptance Checks')
    expect(prd).toContain('## Tracer Bullet Slices')
    expect(prd).toContain('TB-1: Record intake skeleton')
    expect(prd).toContain('Test first:')
    expect(prd).toContain('Implement:')
    expect(prd).toContain('## Traceability Seed')
    expect(prd).toContain('- BRIEF-1:')
  })

  test('creates deterministic tracer slices for selection and TDD execution', () => {
    expect(createDraftTracerSlices()).toEqual([
      {
        id: 'TB-1',
        title: 'Record intake skeleton',
        testFirst:
          'creating the minimum valid record persists it and shows it in a list',
        implement:
          'add the smallest form, persistence path, and list view needed for one record',
      },
      {
        id: 'TB-2',
        title: 'Review workflow path',
        testFirst:
          'a pending record can move to approved or rejected with an audit entry',
        implement:
          'add status transitions, reviewer action controls, and audit recording',
      },
      {
        id: 'TB-3',
        title: 'Validation and role guardrails',
        testFirst:
          'incomplete records are rejected and unauthorized actions are blocked',
        implement:
          'add required-field validation and role checks at the command boundary',
      },
    ])
  })

  test('creates deterministic acceptance checks for eval seeding', () => {
    expect(createDraftAcceptanceChecks()).toEqual([
      'A user can create a valid record from the primary form.',
      'A reviewer can find and act on pending records.',
      'Invalid or incomplete data is rejected with clear feedback.',
      'Important changes are visible in an audit trail.',
    ])
  })

  test('creates deterministic clarifying questions for vague briefs', () => {
    expect(createDraftClarifyingQuestions()).toEqual([
      'Who are the exact user roles and approvers?',
      'What fields are required, optional, or sensitive?',
      'What notifications or integrations are required?',
      'What retention, export, or compliance constraints apply?',
    ])
  })

  test('creates deterministic functional requirements for vague briefs', () => {
    expect(createDraftFunctionalRequirements()).toEqual([
      'Intake form or record creation flow.',
      'List/detail views for submitted records.',
      'Role-aware approval or status workflow where applicable.',
      'Audit trail for important state changes.',
    ])
  })
})
