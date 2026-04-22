import { randomUUID } from 'crypto'

// A subset of @anthropic-ai/claude-agent-sdk's SDKMessage that we actually
// read — kept loose on purpose so the launcher contract doesn't depend on
// the SDK's full type surface.
export type ChildStreamMessage =
  | {
      type: 'system'
      subtype: 'init'
      tools?: string[]
      model?: string
      session_id?: string
      [key: string]: unknown
    }
  | {
      type: 'assistant'
      message?: unknown
      session_id?: string
      [key: string]: unknown
    }
  | {
      type: 'result'
      subtype:
        | 'success'
        | 'error_during_execution'
        | 'error_max_turns'
        | 'error_max_budget_usd'
        | 'error_max_structured_output_retries'
      is_error?: boolean
      num_turns?: number
      duration_ms?: number
      total_cost_usd?: number
      session_id?: string
      errors?: string[]
      [key: string]: unknown
    }
  | {
      type: string
      [key: string]: unknown
    }

export type ChildLauncherParams = {
  prompt: string
  projectDir: string
  allowedTools: string[]
  maxTurns: number
  signal: AbortSignal
}

export type ChildLauncher = (
  params: ChildLauncherParams,
) => AsyncIterable<ChildStreamMessage>

export type ChildRunOptions = {
  taskId: string
  prompt: string
  projectDir: string
  allowedTools: string[]
  maxTurns?: number
  timeoutMs?: number
  runId?: string
}

export type ChildRunExitReason =
  | 'completed'
  | 'timeout'
  | 'error'
  | 'max_turns'
  | 'max_budget'
  | 'auth_failure'

/**
 * User-facing notice surfaced when the daemon detects an auth failure.
 * Keep wording stable — the dashboard, pause file, and status command all
 * quote this string verbatim.
 */
export const AUTH_FAILURE_NOTICE =
  'KAIROS daemon hit an auth failure. Run `claude` interactively once to re-authorize the Keychain entry, then resume the daemon.'

const AUTH_FAILURE_PATTERNS: readonly RegExp[] = [
  /\b401\b/,
  /unauthori[sz]ed/i,
  /authentication[^a-z0-9]*(failed|required|error)/i,
  /invalid[^a-z0-9]*api[^a-z0-9]*key/i,
  /not[^a-z0-9]*authenticated/i,
  /keychain/i,
  /no[^a-z0-9]*credentials/i,
  /missing[^a-z0-9]*credentials/i,
  /oauth[^a-z0-9]*(token[^a-z0-9]*)?(expired|invalid|required)/i,
]

/** True when `err` is recognisably an auth-related failure. */
export function isAuthFailureError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  if (!message) return false
  return AUTH_FAILURE_PATTERNS.some(pattern => pattern.test(message))
}

export type ChildRunResult = {
  runId: string
  ok: boolean
  exitReason: ChildRunExitReason
  sessionId?: string
  costUSD: number
  numTurns: number
  durationMs: number
  allowedTools: string[]
  lastAssistantText?: string
  errorMessage?: string
}

export type ChildEvent =
  | {
      kind: 'child_started'
      t: string
      runId: string
      taskId: string
      allowedTools: string[]
      maxTurns: number
      timeoutMs: number
    }
  | {
      kind: 'child_message'
      t: string
      runId: string
      messageType: string
      sessionId?: string
    }
  | {
      kind: 'child_finished'
      t: string
      runId: string
      exitReason: ChildRunExitReason
      ok: boolean
      costUSD: number
      numTurns: number
      durationMs: number
      sessionId?: string
    }
  | {
      kind: 'child_error'
      t: string
      runId: string
      errorMessage: string
    }
  | {
      kind: 'child_timeout'
      t: string
      runId: string
      timeoutMs: number
    }
  | {
      kind: 'auth_failure'
      t: string
      runId: string
      taskId: string
      projectDir: string
      notice: string
      errorMessage: string
    }

export type ChildRunDeps = {
  launcher: ChildLauncher
  onEvent: (event: ChildEvent) => Promise<void> | void
  now?: () => Date
}

const DEFAULT_MAX_TURNS = 3
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000

function exitReasonFromResult(
  msg: Extract<ChildStreamMessage, { type: 'result' }>,
): ChildRunExitReason {
  switch (msg.subtype) {
    case 'success':
      return 'completed'
    case 'error_max_turns':
      return 'max_turns'
    case 'error_max_budget_usd':
      return 'max_budget'
    default:
      return 'error'
  }
}

function extractAssistantText(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') {
    return undefined
  }

  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') {
    const trimmed = content.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  if (!Array.isArray(content)) {
    return undefined
  }

  const text = content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        !!block &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map(block => block.text)
    .join('\n')
    .trim()

  return text.length > 0 ? text : undefined
}

export async function runChild(
  options: ChildRunOptions,
  deps: ChildRunDeps,
): Promise<ChildRunResult> {
  const now = deps.now ?? (() => new Date())
  const runId = options.runId ?? randomUUID()
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  // Freeze the allowlist at spawn time — the launcher is called with
  // exactly these tools and no mutation afterwards changes them.
  const allowedTools = [...options.allowedTools]

  const controller = new AbortController()
  const startedAtDate = now()
  const startedAtMs = startedAtDate.getTime()

  await deps.onEvent({
    kind: 'child_started',
    t: startedAtDate.toISOString(),
    runId,
    taskId: options.taskId,
    allowedTools,
    maxTurns,
    timeoutMs,
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
    ;(timer as unknown as { unref: () => void }).unref()
  }

  let sessionId: string | undefined
  let resultMessage:
    | Extract<ChildStreamMessage, { type: 'result' }>
    | undefined
  let lastAssistantText: string | undefined
  let streamError: Error | null = null

  try {
    const stream = deps.launcher({
      prompt: options.prompt,
      projectDir: options.projectDir,
      allowedTools,
      maxTurns,
      signal: controller.signal,
    })

    for await (const message of stream) {
      if (!sessionId && typeof message.session_id === 'string') {
        sessionId = message.session_id
      }

      await deps.onEvent({
        kind: 'child_message',
        t: now().toISOString(),
        runId,
        messageType: String(message.type),
        sessionId,
      })

      if (message.type === 'assistant') {
        lastAssistantText =
          extractAssistantText(message.message) ?? lastAssistantText
      }

      if (message.type === 'result') {
        resultMessage = message as Extract<
          ChildStreamMessage,
          { type: 'result' }
        >
      }
    }
  } catch (err) {
    streamError = err instanceof Error ? err : new Error(String(err))
  } finally {
    clearTimeout(timer)
  }

  const finishedAtMs = now().getTime()
  const durationMs = finishedAtMs - startedAtMs

  if (timedOut) {
    await deps.onEvent({
      kind: 'child_timeout',
      t: now().toISOString(),
      runId,
      timeoutMs,
    })

    const result: ChildRunResult = {
      runId,
      ok: false,
      exitReason: 'timeout',
      sessionId,
      costUSD: resultMessage?.total_cost_usd ?? 0,
      numTurns: resultMessage?.num_turns ?? 0,
      durationMs,
      allowedTools,
      lastAssistantText,
      errorMessage: `child run exceeded ${timeoutMs}ms`,
    }
    await deps.onEvent({
      kind: 'child_finished',
      t: now().toISOString(),
      runId,
      exitReason: result.exitReason,
      ok: result.ok,
      costUSD: result.costUSD,
      numTurns: result.numTurns,
      durationMs: result.durationMs,
      sessionId,
    })
    return result
  }

  if (streamError) {
    const authFailure = isAuthFailureError(streamError)
    const exitReason: ChildRunExitReason = authFailure ? 'auth_failure' : 'error'
    if (authFailure) {
      await deps.onEvent({
        kind: 'auth_failure',
        t: now().toISOString(),
        runId,
        taskId: options.taskId,
        projectDir: options.projectDir,
        notice: AUTH_FAILURE_NOTICE,
        errorMessage: streamError.message,
      })
    }
    await deps.onEvent({
      kind: 'child_error',
      t: now().toISOString(),
      runId,
      errorMessage: streamError.message,
    })
    const result: ChildRunResult = {
      runId,
      ok: false,
      exitReason,
      sessionId,
      costUSD: resultMessage?.total_cost_usd ?? 0,
      numTurns: resultMessage?.num_turns ?? 0,
      durationMs,
      allowedTools,
      lastAssistantText,
      errorMessage: authFailure
        ? `${AUTH_FAILURE_NOTICE} (${streamError.message})`
        : streamError.message,
    }
    await deps.onEvent({
      kind: 'child_finished',
      t: now().toISOString(),
      runId,
      exitReason: result.exitReason,
      ok: result.ok,
      costUSD: result.costUSD,
      numTurns: result.numTurns,
      durationMs: result.durationMs,
      sessionId,
    })
    return result
  }

  if (!resultMessage) {
    const result: ChildRunResult = {
      runId,
      ok: false,
      exitReason: 'error',
      sessionId,
      costUSD: 0,
      numTurns: 0,
      durationMs,
      allowedTools,
      lastAssistantText,
      errorMessage: 'child stream ended without a result message',
    }
    await deps.onEvent({
      kind: 'child_error',
      t: now().toISOString(),
      runId,
      errorMessage: result.errorMessage ?? 'missing result',
    })
    await deps.onEvent({
      kind: 'child_finished',
      t: now().toISOString(),
      runId,
      exitReason: result.exitReason,
      ok: result.ok,
      costUSD: result.costUSD,
      numTurns: result.numTurns,
      durationMs: result.durationMs,
      sessionId,
    })
    return result
  }

  const exitReason = exitReasonFromResult(resultMessage)
  const ok = exitReason === 'completed' && resultMessage.is_error !== true

  const result: ChildRunResult = {
    runId,
    ok,
    exitReason,
    sessionId,
    costUSD: resultMessage.total_cost_usd ?? 0,
    numTurns: resultMessage.num_turns ?? 0,
    durationMs: resultMessage.duration_ms ?? durationMs,
    allowedTools,
    lastAssistantText,
    errorMessage: resultMessage.errors?.[0],
  }

  await deps.onEvent({
    kind: 'child_finished',
    t: now().toISOString(),
    runId,
    exitReason: result.exitReason,
    ok: result.ok,
    costUSD: result.costUSD,
    numTurns: result.numTurns,
    durationMs: result.durationMs,
    sessionId,
  })

  return result
}

/**
 * Default launcher backed by @anthropic-ai/claude-agent-sdk's `query()`. Kept
 * as a lazy import so tests that inject their own launcher don't pay the
 * cost of loading the SDK runtime.
 */
export function createSdkChildLauncher(): ChildLauncher {
  return async function* launcher(params) {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    const query = sdk.query({
      prompt: params.prompt,
      options: {
        allowedTools: params.allowedTools,
        maxTurns: params.maxTurns,
        cwd: params.projectDir,
        abortController: (() => {
          // Bridge our AbortSignal to the SDK's AbortController option.
          const ctrl = new AbortController()
          if (params.signal.aborted) ctrl.abort()
          else
            params.signal.addEventListener('abort', () => ctrl.abort(), {
              once: true,
            })
          return ctrl
        })(),
      } as Record<string, unknown>,
    }) as unknown as AsyncIterable<ChildStreamMessage>
    for await (const msg of query) {
      yield msg
    }
  }
}
