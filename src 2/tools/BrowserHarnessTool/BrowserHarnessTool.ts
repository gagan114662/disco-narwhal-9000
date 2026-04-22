import { z } from 'zod/v4'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  BrowserHarnessError,
  runBrowserHarnessScript,
} from './adapter.js'
import {
  BROWSER_HARNESS_TOOL_NAME,
  BROWSER_HARNESS_TOOL_PROMPT,
  DESCRIPTION,
} from './prompt.js'

const MAX_SCRIPT_CHARS = 64 * 1024

const inputSchema = lazySchema(() =>
  z.strictObject({
    script: z
      .string()
      .describe(
        'Python script piped to `browser-harness` on stdin. Helpers like `new_tab`, `goto`, and `page_info` are pre-imported.',
      ),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Optional per-call timeout override in milliseconds. Defaults to 5 minutes.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    exitCode: z.number(),
    stdout: z.string(),
    stderr: z.string(),
    command: z.string().optional(),
    durationMs: z.number().optional(),
    message: z.string(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text
  }
  return `${text.slice(0, max)}\n…(truncated ${text.length - max} chars)`
}

function formatSuccessMessage(stdout: string, stderr: string): string {
  const parts: string[] = []
  const trimmedOut = stdout.trim()
  const trimmedErr = stderr.trim()
  if (trimmedOut.length > 0) {
    parts.push(truncate(trimmedOut, 4000))
  }
  if (trimmedErr.length > 0) {
    parts.push(`stderr:\n${truncate(trimmedErr, 2000)}`)
  }
  if (parts.length === 0) {
    return 'browser-harness script completed with no output.'
  }
  return parts.join('\n\n')
}

function formatFailureMessage(
  exitCode: number,
  stderr: string,
  fallback: string,
): string {
  const trimmed = stderr.trim()
  const suffix = trimmed.length > 0 ? `\n${truncate(trimmed, 4000)}` : ''
  return `browser-harness failed (exit ${exitCode}): ${fallback}${suffix}`
}

function validateInputOrError(input: {
  script: string
  timeoutMs?: number
}): ValidationResult {
  if (typeof input.script !== 'string' || input.script.trim() === '') {
    return {
      result: false,
      message: '`script` must be a non-empty Python payload.',
      errorCode: 1,
    }
  }
  if (input.script.length > MAX_SCRIPT_CHARS) {
    return {
      result: false,
      message: `\`script\` exceeds the ${MAX_SCRIPT_CHARS}-character cap.`,
      errorCode: 1,
    }
  }
  return { result: true }
}

export const BrowserHarnessTool = buildTool({
  name: BROWSER_HARNESS_TOOL_NAME,
  searchHint: 'run a browser-harness python script against the real browser',
  maxResultSizeChars: 20_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return BROWSER_HARNESS_TOOL_PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return input.script
  },
  async validateInput(input) {
    return validateInputOrError(input)
  },
  renderToolUseMessage() {
    return 'Running browser-harness script'
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.message,
      ...(output.success ? {} : { is_error: true }),
    }
  },
  async call({ script, timeoutMs }) {
    try {
      const result = await runBrowserHarnessScript({ script, timeoutMs })
      if (result.success) {
        return {
          data: {
            success: true,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            command: result.command,
            durationMs: result.durationMs,
            message: formatSuccessMessage(result.stdout, result.stderr),
          },
        }
      }
      return {
        data: {
          success: false,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          command: result.command,
          durationMs: result.durationMs,
          error: result.error,
          message: formatFailureMessage(
            result.exitCode,
            result.stderr,
            result.error || 'see stderr',
          ),
        },
      }
    } catch (error) {
      const message =
        error instanceof BrowserHarnessError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'browser-harness invocation failed.'
      return {
        data: {
          success: false,
          exitCode: -1,
          stdout: '',
          stderr: '',
          error: message,
          message,
        },
      }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
