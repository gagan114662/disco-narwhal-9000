import { describe, expect, test } from 'bun:test'
import { deriveDraftTitle, renderDraftPrd } from './draftBuild.js'

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
})
