import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildIssueScaffold,
  buildIssueIdentifiers,
  deriveArtifactStem,
  getIssueCommandHelp,
  parseIssueCommandArgs,
  parseIssueKindToken,
} from './scaffold.js'
import { parseIssueWorkflowArgs, runIssueCommand } from './workflow.js'

const TEMP_DIRS: string[] = []

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'issue-command-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

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

  test('parses explicit kind tokens directly', () => {
    expect(parseIssueKindToken('design')).toBe('spec-design-doc')
    expect(parseIssueKindToken('wo')).toBe('work-order')
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
    expect(help).toContain('--create')
    expect(help).toContain('--upstream')
  })

  test('parses workflow flags for file creation and GitHub issue creation', () => {
    expect(
      parseIssueWorkflowArgs(
        'work-order Add retry budget logging --upstream REQ-FOO-001 --entry src/rpc.ts --label cli --assignee gagan --create',
      ),
    ).toEqual({
      kind: 'work-order',
      title: 'Add retry budget logging',
      create: true,
      repo: undefined,
      upstreamIds: ['REQ-FOO-001'],
      entryPoints: ['src/rpc.ts'],
      labels: ['cli'],
      assignees: ['gagan'],
      trunkExpectation: undefined,
      draftPath: undefined,
    })
  })

  test('writes a draft file and reports validation results', async () => {
    const projectDir = makeProjectDir()
    mkdirSync(join(projectDir, 'docs'), { recursive: true })
    const requirementPath = join(projectDir, 'docs', 'req.md')
    await Bun.write(
      requirementPath,
      'REQ-CHECKOUT-HOLD-001\nAC-REQ-CHECKOUT-HOLD-001.1\n',
    )

    const result = await runIssueCommand(
      'design Define checkout hold flow --upstream REQ-CHECKOUT-HOLD-001 --entry docs/req.md',
      {
        projectDir,
        now: new Date('2026-04-23T10:00:00.000Z'),
        detectRepository: async () => ({
          host: 'github.com',
          owner: 'owner',
          name: 'repo',
        }),
        which: async () => null,
      },
    )

    expect(result).toContain('Draft written to .claude/issue-drafts/')
    expect(result).toContain('RESOLVED: REQ-CHECKOUT-HOLD-001 -> docs/req.md')

    const draftPathMatch = result.match(
      /Draft written to ([^\n]+\.md)/,
    )
    expect(draftPathMatch?.[1]).toBeTruthy()
    const draftPath = join(projectDir, draftPathMatch![1]!)
    const draftBody = readFileSync(draftPath, 'utf8')
    expect(draftBody).toContain('Repository:')
    expect(draftBody).toContain('REQ-CHECKOUT-HOLD-001')
    expect(draftBody).toContain('docs/req.md')
  })

  test('creates a GitHub issue when validation passes and gh succeeds', async () => {
    const projectDir = makeProjectDir()
    mkdirSync(join(projectDir, 'docs'), { recursive: true })
    await Bun.write(
      join(projectDir, 'docs', 'req.md'),
      'REQ-CHECKOUT-HOLD-001\nDES-CHECKOUT-HOLD-001\n',
    )

    const result = await runIssueCommand(
      'work-order Add retry budget logging --upstream REQ-CHECKOUT-HOLD-001 --upstream DES-CHECKOUT-HOLD-001 --create --repo owner/repo',
      {
        projectDir,
        getGhAuthStatus: async () => 'authenticated',
        which: async () => null,
        exec: async (file, args) => {
          expect(file).toBe('gh')
          expect(args).toContain('issue')
          expect(args).toContain('create')
          expect(args).toContain('--repo')
          expect(args).toContain('owner/repo')
          return {
            code: 0,
            stdout: 'https://github.com/owner/repo/issues/123\n',
            stderr: '',
          }
        },
      },
    )

    expect(result).toContain('Created issue: https://github.com/owner/repo/issues/123')
  })

  test('blocks GitHub creation when required upstream refs are missing', async () => {
    const projectDir = makeProjectDir()

    const result = await runIssueCommand(
      'work-order Add retry budget logging --create --repo owner/repo',
      {
        projectDir,
        getGhAuthStatus: async () => 'authenticated',
        which: async () => null,
        exec: async () => {
          throw new Error('should not run gh')
        },
      },
    )

    expect(result).toContain('BLOCKING:')
    expect(result).toContain('Issue creation skipped because validation failed.')
  })
})
