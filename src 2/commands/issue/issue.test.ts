import { describe, expect, test } from 'bun:test'
import {
  buildIssueScaffold,
  getIssueCommandHelp,
  parseIssueCommandArgs,
} from './scaffold.js'

describe('/issue scaffold', () => {
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
      parseIssueCommandArgs('spec Define remote session reconnect behavior'),
    ).toEqual({
      kind: 'spec-design-doc',
      title: 'Define remote session reconnect behavior',
      usedPlaceholderTitle: false,
    })
  })

  test('falls back to a placeholder title when only the kind is provided', () => {
    expect(parseIssueCommandArgs('leaf')).toEqual({
      kind: 'leaf-build',
      title: 'TODO: concise, outcome-focused issue title',
      usedPlaceholderTitle: true,
    })
  })

  test('returns null for an invalid type flag', () => {
    expect(parseIssueCommandArgs('--type nope bad')).toBeNull()
  })

  test('renders the canonical model-executable sections', () => {
    const scaffold = buildIssueScaffold({
      kind: 'leaf-build',
      title: 'Add issue templates and revive /issue',
    })

    expect(scaffold).toContain('# Add issue templates and revive /issue')
    expect(scaffold).toContain('Type: leaf build')
    expect(scaffold).toContain('## Problem')
    expect(scaffold).toContain('## User/Developer Impact')
    expect(scaffold).toContain('## Scope')
    expect(scaffold).toContain('## Out of Scope')
    expect(scaffold).toContain('## Acceptance Criteria')
    expect(scaffold).toContain('## Suggested Entry Points')
    expect(scaffold).toContain('## Verification / Test Plan')
    expect(scaffold).toContain('## Trunk Expectations')
  })

  test('documents the supported invocation patterns', () => {
    const help = getIssueCommandHelp()
    expect(help).toContain('/issue [leaf|spec|bug] <title>')
    expect(help).toContain('/issue --type <leaf|spec|bug> <title>')
  })
})
