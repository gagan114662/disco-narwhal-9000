import { afterEach, describe, expect, test } from 'bun:test'
import type {
  ChildEvent,
  ChildLauncher,
  ChildLauncherParams,
  ChildStreamMessage,
} from './childRunner.js'
import {
  AUTH_FAILURE_NOTICE,
  isAuthFailureError,
  runChild,
} from './childRunner.js'

type RecordedCall = {
  params: ChildLauncherParams
}

function makeLauncher(
  messages: ChildStreamMessage[],
  opts: { delayMs?: number; throwError?: Error } = {},
): { launcher: ChildLauncher; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const launcher: ChildLauncher = async function* (params) {
    calls.push({ params })
    if (opts.throwError) throw opts.throwError
    for (const msg of messages) {
      if (opts.delayMs) {
        await Bun.sleep(opts.delayMs)
        if (params.signal.aborted) {
          // Respect the caller's timeout — abort ends the stream.
          return
        }
      }
      yield msg
    }
  }
  return { launcher, calls }
}

function makeNow(startMs: number, stepMs = 10): () => Date {
  let current = startMs
  return () => {
    const date = new Date(current)
    current += stepMs
    return date
  }
}

afterEach(() => {
  // No shared state to clear.
})

describe('childRunner.runChild', () => {
  test('happy path: records stream events and extracts cost', async () => {
    const events: ChildEvent[] = []
    const { launcher, calls } = makeLauncher([
      {
        type: 'system',
        subtype: 'init',
        tools: ['Read'],
        session_id: 'sess-1',
      },
      {
        type: 'assistant',
        session_id: 'sess-1',
        message: {
          content: [{ type: 'text', text: '{"surface":false}' }],
        },
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 2,
        duration_ms: 1234,
        total_cost_usd: 0.042,
        session_id: 'sess-1',
      },
    ])

    const result = await runChild(
      {
        taskId: 't-happy',
        prompt: 'hello',
        projectDir: '/tmp/proj',
        allowedTools: ['Read'],
        maxTurns: 3,
        timeoutMs: 5000,
        runId: 'run-happy',
      },
      {
        launcher,
        onEvent: e => {
          events.push(e)
        },
        now: makeNow(1_700_000_000_000),
      },
    )

    expect(result.ok).toBe(true)
    expect(result.exitReason).toBe('completed')
    expect(result.costUSD).toBe(0.042)
    expect(result.numTurns).toBe(2)
    expect(result.sessionId).toBe('sess-1')
    expect(result.allowedTools).toEqual(['Read'])
    expect(result.lastAssistantText).toBe('{"surface":false}')

    expect(calls).toHaveLength(1)
    const startEvents = events.filter(e => e.kind === 'child_started')
    const messageEvents = events.filter(e => e.kind === 'child_message')
    const finishedEvents = events.filter(e => e.kind === 'child_finished')
    expect(startEvents).toHaveLength(1)
    expect(messageEvents).toHaveLength(3)
    expect(finishedEvents).toHaveLength(1)
  })

  test('emits tool_used for each tool_use block in assistant messages', async () => {
    const events: ChildEvent[] = []
    const { launcher } = makeLauncher([
      {
        type: 'assistant',
        session_id: 'sess-tu',
        message: {
          content: [
            { type: 'text', text: 'invoking a skill' },
            {
              type: 'tool_use',
              id: 't1',
              name: 'Skill',
              input: { skill: 'investigate' },
            },
            {
              type: 'tool_use',
              id: 't2',
              name: 'Read',
              input: { file_path: '/tmp/x' },
            },
          ],
        },
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0,
        session_id: 'sess-tu',
      },
    ])

    await runChild(
      {
        taskId: 't-tu',
        prompt: 'hi',
        projectDir: '/tmp/proj',
        allowedTools: ['Read', 'Skill'],
        runId: 'run-tu',
      },
      {
        launcher,
        onEvent: e => {
          events.push(e)
        },
        now: makeNow(1_700_000_000_000),
      },
    )

    const toolUsed = events.filter(e => e.kind === 'tool_used')
    expect(toolUsed).toHaveLength(2)
    // Order preserved.
    expect(toolUsed[0]).toMatchObject({
      kind: 'tool_used',
      runId: 'run-tu',
      toolName: 'Skill',
      toolInput: { skill: 'investigate' },
      sessionId: 'sess-tu',
    })
    expect(toolUsed[1]).toMatchObject({
      kind: 'tool_used',
      runId: 'run-tu',
      toolName: 'Read',
    })
  })

  test('assistant message with no tool_use blocks emits no tool_used events', async () => {
    const events: ChildEvent[] = []
    const { launcher } = makeLauncher([
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'no tools here' }] },
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0,
      },
    ])

    await runChild(
      {
        taskId: 't-no-tu',
        prompt: 'hi',
        projectDir: '/tmp/proj',
        allowedTools: ['Read'],
      },
      {
        launcher,
        onEvent: e => {
          events.push(e)
        },
        now: makeNow(1_700_000_000_000),
      },
    )

    expect(events.some(e => e.kind === 'tool_used')).toBe(false)
  })

  test('tool allowlist boundary: launcher receives exactly the configured tools', async () => {
    const { launcher, calls } = makeLauncher([
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0.01,
      },
    ])

    await runChild(
      {
        taskId: 't-allow',
        prompt: 'hi',
        projectDir: '/tmp/proj',
        // Caller presents a broader list; the runner must pass it through
        // verbatim and freeze it on the result — extra mutations to the
        // caller-owned array post-spawn must not leak in.
        allowedTools: ['Read', 'Glob'],
        runId: 'run-allow',
      },
      {
        launcher,
        onEvent: () => {},
        now: makeNow(1_700_000_000_000),
      },
    )

    expect(calls[0]?.params.allowedTools).toEqual(['Read', 'Glob'])

    // Ensure the runner does not retain a reference to the caller's array.
    const callerArray = ['Read']
    await runChild(
      {
        taskId: 't-allow-2',
        prompt: 'hi',
        projectDir: '/tmp/proj',
        allowedTools: callerArray,
        runId: 'run-allow-2',
      },
      {
        launcher,
        onEvent: () => {},
        now: makeNow(1_700_000_000_000),
      },
    )
    callerArray.push('Bash')
    expect(calls[1]?.params.allowedTools).toEqual(['Read'])
  })

  test('timeout: aborts stream and reports timeout reason', async () => {
    const events: ChildEvent[] = []
    const { launcher } = makeLauncher(
      [
        { type: 'system', subtype: 'init' },
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          num_turns: 1,
          total_cost_usd: 0,
        },
      ],
      { delayMs: 200 },
    )

    const result = await runChild(
      {
        taskId: 't-timeout',
        prompt: 'slow',
        projectDir: '/tmp/proj',
        allowedTools: [],
        timeoutMs: 50,
        runId: 'run-timeout',
      },
      {
        launcher,
        onEvent: e => {
          events.push(e)
        },
      },
    )

    expect(result.ok).toBe(false)
    expect(result.exitReason).toBe('timeout')
    expect(events.some(e => e.kind === 'child_timeout')).toBe(true)
  })

  test('error: launcher throws → exitReason=error and error event written', async () => {
    const events: ChildEvent[] = []
    const { launcher } = makeLauncher([], {
      throwError: new Error('boom'),
    })

    const result = await runChild(
      {
        taskId: 't-err',
        prompt: 'x',
        projectDir: '/tmp/proj',
        allowedTools: [],
        runId: 'run-err',
      },
      {
        launcher,
        onEvent: e => {
          events.push(e)
        },
      },
    )

    expect(result.ok).toBe(false)
    expect(result.exitReason).toBe('error')
    expect(result.errorMessage).toBe('boom')
    expect(events.some(e => e.kind === 'child_error')).toBe(true)
  })

  test('stream ends without result message → error with missing-result message', async () => {
    const events: ChildEvent[] = []
    const { launcher } = makeLauncher([
      { type: 'system', subtype: 'init' },
    ])

    const result = await runChild(
      {
        taskId: 't-no-result',
        prompt: 'x',
        projectDir: '/tmp/proj',
        allowedTools: [],
        runId: 'run-no-result',
      },
      {
        launcher,
        onEvent: e => {
          events.push(e)
        },
      },
    )

    expect(result.ok).toBe(false)
    expect(result.exitReason).toBe('error')
    expect(result.errorMessage).toContain('without a result')
    expect(events.some(e => e.kind === 'child_error')).toBe(true)
  })

  test('result with error_max_budget_usd → exitReason=max_budget', async () => {
    const events: ChildEvent[] = []
    const { launcher } = makeLauncher([
      {
        type: 'result',
        subtype: 'error_max_budget_usd',
        is_error: true,
        num_turns: 5,
        duration_ms: 9000,
        total_cost_usd: 1.0,
        errors: ['budget exceeded'],
      },
    ])

    const result = await runChild(
      {
        taskId: 't-max',
        prompt: 'x',
        projectDir: '/tmp/proj',
        allowedTools: [],
        runId: 'run-max',
      },
      {
        launcher,
        onEvent: e => {
          events.push(e)
        },
      },
    )

    expect(result.ok).toBe(false)
    expect(result.exitReason).toBe('max_budget')
    expect(result.costUSD).toBe(1.0)
    expect(result.errorMessage).toBe('budget exceeded')
  })

  test('auth failure: launcher throws an auth error → exitReason=auth_failure + auth_failure event', async () => {
    const events: ChildEvent[] = []
    const { launcher } = makeLauncher([], {
      throwError: new Error('Request failed: 401 Unauthorized'),
    })

    const result = await runChild(
      {
        taskId: 't-auth',
        prompt: 'x',
        projectDir: '/tmp/proj',
        allowedTools: [],
        runId: 'run-auth',
      },
      {
        launcher,
        onEvent: e => {
          events.push(e)
        },
      },
    )

    expect(result.ok).toBe(false)
    expect(result.exitReason).toBe('auth_failure')
    expect(result.errorMessage).toContain('re-authorize')

    const authEvent = events.find(e => e.kind === 'auth_failure')
    expect(authEvent).toBeDefined()
    if (authEvent && authEvent.kind === 'auth_failure') {
      expect(authEvent.notice).toBe(AUTH_FAILURE_NOTICE)
      expect(authEvent.taskId).toBe('t-auth')
      expect(authEvent.projectDir).toBe('/tmp/proj')
    }
  })
})

describe('isAuthFailureError', () => {
  test.each([
    '401 Unauthorized',
    'Authentication failed',
    'authentication required',
    'Invalid API key',
    'Keychain returned errSecAuthFailed',
    'OAuth token expired',
    'no credentials available',
  ])('classifies %p as auth failure', message => {
    expect(isAuthFailureError(new Error(message))).toBe(true)
  })

  test.each([
    'ECONNREFUSED',
    'budget exceeded',
    'timeout',
    '',
    // Adversarial: words that used to match but shouldn't. A bare "keychain"
    // mention or "no credentials" phrase from an unrelated subsystem must
    // not globally pause the daemon.
    'Keychain service temporarily unavailable',
    'Keychain backup completed',
    'no credentials needed for this endpoint',
    'oauth configuration loaded',
    'Authentication service starting',
    'HTTP 403 file not found',
  ])('does NOT classify %p as auth failure', message => {
    expect(isAuthFailureError(new Error(message))).toBe(false)
  })

  test('tolerates non-Error values', () => {
    expect(isAuthFailureError('401 Unauthorized')).toBe(true)
    expect(isAuthFailureError(null)).toBe(false)
    expect(isAuthFailureError(undefined)).toBe(false)
  })
})
