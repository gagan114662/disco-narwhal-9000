import { describe, expect, test } from 'bun:test'
import {
  buildIssueScaffold,
  buildIssueIdentifiers,
  deriveArtifactStem,
  getIssueCommandHelp,
  parseIssueCommandArgs,
} from './scaffold.js'

describe('/issue scaffold', () => {
  test('parses requirement aliases', () => {
    expect(
      parseIssueCommandArgs('requirement Define checkout fulfillment holds'),
    ).toEqual({
      kind: 'requirement-definition',
      title: 'Define checkout fulfillment holds',
      usedPlaceholderTitle: false,
    })
  })

  test('parses explicit type flags and preserves the remaining title', () => {
    expect(
      parseIssueCommandArgs('--type bug Settings panel drops unsaved edits'),
    ).toEqual({
      kind: 'bug-regression',
      title: 'Settings panel drops unsaved edits',
      usedPlaceholderTitle: false,
    })
  })

  test('treats the first token as a kind alias when it matches a template', () => {
    expect(
      parseIssueCommandArgs('design Define remote session reconnect behavior'),
    ).toEqual({
      kind: 'spec-design-doc',
      title: 'Define remote session reconnect behavior',
      usedPlaceholderTitle: false,
    })
  })

  test('falls back to a placeholder title when only the kind is provided', () => {
    expect(parseIssueCommandArgs('work-order')).toEqual({
      kind: 'work-order',
      title: 'TODO: concise, outcome-focused issue title',
      usedPlaceholderTitle: true,
    })
  })

  test('returns null for an invalid type flag', () => {
    expect(parseIssueCommandArgs('--type nope bad')).toBeNull()
  })

  test('derives stable artifact identifiers from the title', () => {
    expect(deriveArtifactStem('Add retry budget logging to the RPC client')).toBe(
      'ADD-RETRY-BUDGET',
    )
    expect(
      buildIssueIdentifiers('work-order', 'Add retry budget logging to the RPC client'),
    ).toEqual({
      artifactId: 'WO-ADD-RETRY-BUDGET-001',
      acceptanceBaseId: 'AC-WO-ADD-RETRY-BUDGET-001',
      coverageId: 'COV-WO-ADD-RETRY-BUDGET-001',
    })
  })

  test('renders deterministic work-order sections and IDs', () => {
    const scaffold = buildIssueScaffold({
      kind: 'work-order',
      title: 'Add issue templates and revive /issue',
    })

    expect(scaffold).toContain('# Add issue templates and revive /issue')
    expect(scaffold).toContain('Artifact Type: work order')
    expect(scaffold).toContain('Artifact ID: WO-ADD-ISSUE-TEMPLATES-001')
    expect(scaffold).toContain('Transformation Rule:')
    expect(scaffold).toContain('## Summary')
    expect(scaffold).toContain('## In Scope')
    expect(scaffold).toContain('## Out of Scope')
    expect(scaffold).toContain('## Requirements')
    expect(scaffold).toContain('## Blueprints / Design References')
    expect(scaffold).toContain('## Acceptance Criteria')
    expect(scaffold).toContain('## Suggested Entry Points')
    expect(scaffold).toContain('## E2E Acceptance Tests')
    expect(scaffold).toContain('AC-WO-ADD-ISSUE-TEMPLATES-001.1')
    expect(scaffold).toContain('COV-WO-ADD-ISSUE-TEMPLATES-001')
    expect(scaffold).toContain('## Trunk Expectations')
  })

  test('documents the supported invocation patterns', () => {
    const help = getIssueCommandHelp()
    expect(help).toContain('/issue [requirement|design|work-order|bug] <title>')
    expect(help).toContain(
      '/issue --type <requirement|design|work-order|bug> <title>',
    )
  })
})
