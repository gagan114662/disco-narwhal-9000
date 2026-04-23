import { afterEach, describe, expect, test } from 'bun:test'
import { _resetForTesting, attachAnalyticsSink } from './index.js'
import {
  _validateWideEventForTesting,
  emitWideTaskLifecycleEvent,
  getWideEventAgentFamily,
  getWideEventModelFamily,
  getWideEventToolFamily,
  normalizeWidePermissionSource,
  summarizeDiagnosticRegression,
  type WideTaskLifecycleEvent,
  wideEventDefinitions,
} from './wideEvents.js'

afterEach(() => {
  _resetForTesting()
})

describe('wideEventDefinitions', () => {
  test('keeps the canonical event names stable', () => {
    expect(wideEventDefinitions.taskLifecycle.eventName).toBe(
      'tengu_wide_task_lifecycle',
    )
    expect(wideEventDefinitions.agentLifecycle.eventName).toBe(
      'tengu_wide_agent_lifecycle',
    )
    expect(wideEventDefinitions.toolExecution.eventName).toBe(
      'tengu_wide_tool_execution',
    )
    expect(wideEventDefinitions.diagnosticsRegression.eventName).toBe(
      'tengu_wide_diagnostics_regression',
    )
  })

  test('rejects missing required fields outside production', () => {
    expect(() =>
      _validateWideEventForTesting('taskLifecycle', {
        lifecycle: 'created',
        task_family: 'local_agent',
        execution_mode: 'foreground',
      } as unknown as WideTaskLifecycleEvent),
    ).toThrow('has_tool_use_id')
  })
})

describe('wide event helpers', () => {
  test('collapses custom agents and buckets model families', () => {
    expect(getWideEventAgentFamily('repo-qa', false)).toBe('custom')
    expect(getWideEventAgentFamily('general-purpose', true)).toBe(
      'general-purpose',
    )
    expect(getWideEventModelFamily('claude-sonnet-4-6')).toBe('sonnet')
    expect(getWideEventModelFamily('claude-opus-4-1')).toBe('opus')
    expect(getWideEventModelFamily('claude-haiku-4-5')).toBe('haiku')
    expect(getWideEventModelFamily('claude-unknown')).toBe('other')
  })

  test('normalizes tool families and permission sources', () => {
    expect(getWideEventToolFamily('mcp__github__search')).toBe('mcp')
    expect(getWideEventToolFamily('Bash')).toBe('Bash')
    expect(normalizeWidePermissionSource('hook')).toBe('hook')
    expect(normalizeWidePermissionSource('strange-source')).toBe('unknown')
  })

  test('summarizes diagnostics regressions without file paths', () => {
    expect(
      summarizeDiagnosticRegression(
        [
          {
            uri: 'file:///tmp/example.ts',
            diagnostics: [
              {
                message: 'bad',
                severity: 'Error',
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 1 },
                },
                source: 'eslint',
              },
              {
                message: 'warn',
                severity: 'Warning',
                range: {
                  start: { line: 1, character: 0 },
                  end: { line: 1, character: 1 },
                },
              },
            ],
          },
        ],
        3,
      ),
    ).toEqual({
      change: 'worsened_after_edit',
      tracked_file_count: 3,
      affected_file_count: 1,
      diagnostic_count: 2,
      error_count: 1,
      warning_count: 1,
      info_count: 0,
      hint_count: 0,
      has_linter_diagnostics: true,
    })
  })
})

describe('emitWideTaskLifecycleEvent', () => {
  test('routes canonical events through the analytics sink', () => {
    const logged: Array<{
      eventName: string
      metadata: unknown
    }> = []

    attachAnalyticsSink({
      logEvent(eventName, metadata) {
        logged.push({ eventName, metadata })
      },
      async logEventAsync() {},
    })

    emitWideTaskLifecycleEvent({
      lifecycle: 'completed',
      task_family: 'local_agent',
      execution_mode: 'background',
      has_tool_use_id: true,
      duration_ms: 42,
    })

    expect(logged).toEqual([
      {
        eventName: 'tengu_wide_task_lifecycle',
        metadata: {
          lifecycle: 'completed',
          task_family: 'local_agent',
          execution_mode: 'background',
          has_tool_use_id: true,
          duration_ms: 42,
        },
      },
    ])
  })
})
