import { describe, expect, test } from 'bun:test'
import {
  clusterDiagnostics,
  formatDiagnosticsBacklogMarkdown,
  normalizeDiagnosticMessage,
} from './diagnosticBacklog.js'
import type { DiagnosticFile } from './diagnosticTracking.js'

const SAMPLE_DIAGNOSTICS: DiagnosticFile[] = [
  {
    uri: 'file:///repo/src/example.ts',
    diagnostics: [
      {
        message: `Type '"left"' is not assignable to type '"right"'`,
        severity: 'Error',
        code: 'TS2322',
        source: 'ts',
        range: {
          start: { line: 2, character: 4 },
          end: { line: 2, character: 9 },
        },
      },
      {
        message: `Type '"alpha"'   is not assignable to type '"beta"'`,
        severity: 'Error',
        code: 'TS2322',
        source: 'ts',
        range: {
          start: { line: 6, character: 1 },
          end: { line: 6, character: 5 },
        },
      },
      {
        message: 'Unused import.',
        severity: 'Warning',
        code: 'TS6133',
        source: 'ts',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
      },
    ],
  },
  {
    uri: 'file:///repo/src/other.ts',
    diagnostics: [
      {
        message: `Type '"left"' is not assignable to type '"right"'`,
        severity: 'Error',
        code: 'TS2322',
        source: 'ts',
        range: {
          start: { line: 10, character: 2 },
          end: { line: 10, character: 8 },
        },
      },
    ],
  },
]

describe('diagnostic backlog normalization', () => {
  test('normalizes whitespace and quoted literals', () => {
    expect(
      normalizeDiagnosticMessage(
        `Type   '"left"' is not assignable to type "right" in \`foo\``,
      ),
    ).toBe(`Type '…' is not assignable to type "…" in \`…\``)
  })
})

describe('diagnostic backlog clustering', () => {
  test('groups diagnostics by file, code, and normalized message', () => {
    const report = clusterDiagnostics(SAMPLE_DIAGNOSTICS)

    expect(report.totalDiagnostics).toBe(4)
    expect(report.totalFiles).toBe(2)
    expect(report.clusters).toHaveLength(3)
    expect(report.clusters[0]).toMatchObject({
      displayPath: '/repo/src/example.ts',
      code: 'TS2322',
      count: 2,
    })
    expect(report.clusters[0]?.exampleLocations).toEqual([
      { line: 2, character: 4 },
      { line: 6, character: 1 },
    ])
  })

  test('renders issue-ready markdown with verification steps', () => {
    const markdown = formatDiagnosticsBacklogMarkdown(SAMPLE_DIAGNOSTICS, {
      scope: 'current',
    })

    expect(markdown).toContain('# Diagnostic Repair Backlog')
    expect(markdown).toContain('## Cluster 1: /repo/src/example.ts')
    expect(markdown).toContain('Title suggestion: Reduce TS2322 in example.ts:')
    expect(markdown).toContain('Acceptance target: The TS2322 cluster is reduced to zero')
    expect(markdown).toContain('Re-run `/diagnostics-backlog current`.')
    expect(markdown).toContain('Leaf-build candidate: Yes')
  })

  test('returns a short no-op message when there are no diagnostics', () => {
    expect(
      formatDiagnosticsBacklogMarkdown([], {
        scope: 'new',
      }),
    ).toBe(
      'No new diagnostic clusters since the last `/diagnostics-backlog snapshot` baseline.',
    )
  })
})
