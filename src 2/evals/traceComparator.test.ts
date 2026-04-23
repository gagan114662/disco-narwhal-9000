import { describe, expect, test } from 'bun:test'
import { compareTraces } from './compare.js'
import { deserializeTrace, serializeTrace } from './serialize.js'
import type { Trace } from './types.js'

function makeTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    meta: {
      caseId: 'case-1',
      commitSha: 'abc123',
      harnessVersion: 1,
    },
    toolCalls: [
      {
        tool: 'Read',
        inputSha: 'in-1',
        outputSha: 'out-1',
        durationMs: '<100ms',
      },
    ],
    wideEvents: [
      {
        name: 'tool_started',
        phase: 'run',
        keysPresent: ['tool', 'inputSha'],
      },
    ],
    finalResponseSha: 'final-1',
    exitCode: 0,
    ...overrides,
  }
}

describe('trace comparator', () => {
  test('Identical traces -> empty diff', () => {
    const trace = makeTrace()
    const expected = deserializeTrace(serializeTrace(trace))
    const actual = deserializeTrace(serializeTrace(trace))

    expect(compareTraces(expected, actual)).toEqual([])
  })

  test('Traces that differ only in ignored fields -> empty diff', () => {
    const expected = makeTrace()
    const actual = makeTrace({
      meta: {
        ...expected.meta,
        commitSha: 'def456',
      },
    })

    expect(compareTraces(expected, actual)).toEqual([])
  })

  test('Extra tool call -> diff reports it', () => {
    const expected = makeTrace()
    const actual = makeTrace({
      toolCalls: [
        ...expected.toolCalls,
        {
          tool: 'Write',
          inputSha: 'in-2',
          outputSha: 'out-2',
          durationMs: '100-1000ms',
        },
      ],
    })

    expect(compareTraces(expected, actual)).toEqual([
      {
        path: ['toolCalls', '1'],
        kind: 'extra',
        actual: actual.toolCalls[1],
      },
    ])
  })

  test('Missing wide event -> diff reports it', () => {
    const expected = makeTrace({
      wideEvents: [
        {
          name: 'tool_started',
          phase: 'run',
          keysPresent: ['tool', 'inputSha'],
        },
        {
          name: 'tool_finished',
          phase: 'run',
          keysPresent: ['tool', 'outputSha'],
        },
      ],
    })
    const actual = makeTrace({
      wideEvents: [expected.wideEvents[0]!],
    })

    expect(compareTraces(expected, actual)).toEqual([
      {
        path: ['wideEvents', '1'],
        kind: 'missing',
        expected: expected.wideEvents[1],
      },
    ])
  })

  test('Changed finalResponseSha -> diff reports it', () => {
    const expected = makeTrace()
    const actual = makeTrace({
      finalResponseSha: 'final-2',
    })

    expect(compareTraces(expected, actual)).toEqual([
      {
        path: ['finalResponseSha'],
        kind: 'changed',
        expected: 'final-1',
        actual: 'final-2',
      },
    ])
  })
})
