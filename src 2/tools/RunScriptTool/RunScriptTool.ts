import { spawn } from 'child_process'
import { parse as parseShellCommand } from 'shell-quote'
import { z } from 'zod/v4'
import type { ToolUseContext } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getKairosRpcConfig } from '../../services/rpc/config.js'
import { createRpcGrant, deleteRpcGrant } from '../../services/rpc/authToken.js'
import { getRpcAllowedToolNames } from '../../services/rpc/toolAllowlist.js'

const RUN_SCRIPT_TOOL_NAME = 'RunScript'
const TRUNCATION_MARKER = '\n...[stdout truncated]'

const inputSchema = lazySchema(() =>
  z.strictObject({
    script: z
      .string()
      .min(1)
      .describe('Command line for a local script process, e.g. `python3 -c "print(1)"`.'),
    timeoutSec: z
      .number()
      .int()
      .positive()
      .max(300)
      .optional()
      .describe('Optional wall-clock timeout override in seconds.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    stdout: z.string(),
    truncated: z.boolean(),
    exitCode: z.number(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function parseCommand(script: string): { command: string; args: string[] } {
  const tokens = parseShellCommand(script)
  const words = tokens.map(token => {
    if (typeof token !== 'string') {
      throw new Error('Script command cannot use shell control operators')
    }
    return token
  })
  if (words.length === 0) {
    throw new Error('Script command is empty')
  }
  return {
    command: words[0]!,
    args: words.slice(1),
  }
}

async function runScriptProcess(
  input: { script: string; timeoutSec?: number },
  context: ToolUseContext,
): Promise<Output> {
  const config = getKairosRpcConfig()
  if (!config.enabled) {
    throw new Error('KAIROS RPC is disabled. Set `kairos.rpc.enabled` to true in settings.')
  }

  const timeoutSec = Math.min(
    input.timeoutSec ?? config.defaultTimeoutSec,
    config.maxTimeoutSec,
  )
  const permissionContext = context.getAppState().toolPermissionContext
  const allowedTools = getRpcAllowedToolNames(context.options.tools, permissionContext)
  const grant = await createRpcGrant({
    projectDir: getCwd(),
    allowedTools,
    permissionContext,
    maxCalls: config.maxCallsPerInvocation,
    expiresAt: new Date(Date.now() + (timeoutSec + 5) * 1000),
  })

  try {
    const { command, args } = parseCommand(input.script)
    const child = spawn(command, args, {
      cwd: getCwd(),
      env: {
        ...process.env,
        KAIROS_SOCKET: config.socketPath,
        KAIROS_TOKEN: grant.token,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')

    let stdout = ''
    let stderr = ''
    let truncated = false

    child.stdout?.on('data', chunk => {
      if (truncated) return
      stdout += String(chunk)
      if (stdout.length > config.stdoutCapBytes) {
        stdout =
          stdout.slice(
            0,
            Math.max(0, config.stdoutCapBytes - TRUNCATION_MARKER.length),
          ) + TRUNCATION_MARKER
        truncated = true
      }
    })

    child.stderr?.on('data', chunk => {
      stderr += String(chunk)
    })

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
    }, timeoutSec * 1000)

    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => resolve(code ?? 1))
    }).finally(() => {
      clearTimeout(timeout)
    })

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || `Script exited with code ${exitCode}`)
    }

    return {
      stdout,
      truncated,
      exitCode,
    }
  } finally {
    await deleteRpcGrant(grant.token)
  }
}

export const RunScriptTool = buildTool({
  name: RUN_SCRIPT_TOOL_NAME,
  searchHint: 'run a local script that can call KAIROS RPC tools',
  maxResultSizeChars: 20_000,
  async description() {
    return 'Run a local script subprocess with KAIROS tool RPC access.'
  },
  async prompt() {
    return 'Runs a local script subprocess. The subprocess receives `KAIROS_SOCKET` and `KAIROS_TOKEN` so it can call KAIROS RPC tools.'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isEnabled() {
    return getKairosRpcConfig().enabled
  },
  isReadOnly() {
    return false
  },
  renderToolUseMessage() {
    return 'Running a local script'
  },
  async call(input, context) {
    return {
      data: await runScriptProcess(input, context),
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.stdout,
    }
  },
} satisfies ToolDef<InputSchema, Output>)

export { runScriptProcess }
