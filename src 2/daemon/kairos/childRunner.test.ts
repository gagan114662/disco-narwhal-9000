import { afterEach, describe, expect, test } from 'bun:test'
import type {
  ChildEvent,
  ChildLauncher,
  ChildLauncherParams,
  ChildStreamMessage,
} from './childRunner.js'
import { runChild } from './childRunner.js'

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
      { type: 'assistant', session_id: 'sess-1' },
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

    expect(calls).toHaveLength(1)
    const startEvents = events.filter(e => e.kind === 'child_started')
    const messageEvents = events.filter(e => e.kind === 'child_message')
    const finishedEvents = events.filter(e => e.kind === 'child_finished')
    expect(startEvents).toHaveLength(1)
    expect(messageEvents).toHaveLength(3)
    expect(finishedEvents).toHaveLength(1)
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
})
