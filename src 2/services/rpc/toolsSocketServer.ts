import { createServer, type Server, type Socket } from 'net'
import { chmod, mkdir, rm } from 'fs/promises'
import { dirname } from 'path'
import { createAbortController } from '../../utils/abortController.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import { logError } from '../../utils/log.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { createAssistantMessage } from '../../utils/messages.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import { findToolByName, type Tool, type ToolUseContext } from '../../Tool.js'
import { getTools } from '../../tools.js'
import {
  cleanupExpiredRpcGrants,
  deserializeToolPermissionContext,
  ensureRpcGrantDir,
  readRpcGrant,
} from './authToken.js'
import {
  applyLegacyRpcInputAliases,
  filterRpcTools,
  normalizeRpcToolName,
} from './toolAllowlist.js'

type RpcRequest = {
  id: string | number | null
  method: 'list_tools' | 'call_tool'
  params?: Record<string, unknown>
}

type RpcResponse = {
  id: string | number | null
  result?: unknown
  error?: { code: string; message: string }
}

const callCounts = new Map<string, number>()

export type ToolsSocketServerHandle = {
  socketPath: string
  stop(): Promise<void>
}

function createToolUseContext(permissionContext: ReturnType<typeof deserializeToolPermissionContext>, tools: Tool[]): ToolUseContext {
  const defaultState = getDefaultAppState()
  const appState = {
    ...defaultState,
    toolPermissionContext: permissionContext,
  }

  return {
    abortController: createAbortController(),
    options: {
      commands: [],
      tools,
      mainLoopModel: getMainLoopModel(),
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      debug: false,
      verbose: false,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    getAppState: () => appState,
    setAppState: () => {},
    messages: [],
    readFileState: createFileStateCacheWithSizeLimit(64),
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  }
}

async function executeRpcToolCall(request: RpcRequest): Promise<RpcResponse> {
  const token =
    typeof request.params?.token === 'string' ? request.params.token : null
  if (!token) {
    return {
      id: request.id,
      error: { code: 'unauthorized', message: 'KAIROS_TOKEN is required' },
    }
  }

  const grant = await readRpcGrant(token)
  if (!grant) {
    return {
      id: request.id,
      error: { code: 'unauthorized', message: 'Invalid or expired KAIROS_TOKEN' },
    }
  }

  const currentCallCount = callCounts.get(token) ?? 0
  if (currentCallCount >= grant.maxCalls) {
    return {
      id: request.id,
      error: {
        code: 'rate_limited',
        message: `RPC call limit exceeded (${grant.maxCalls})`,
      },
    }
  }
  callCounts.set(token, currentCallCount + 1)

  const permissionContext = deserializeToolPermissionContext(
    grant.permissionContext,
  )
  const availableTools = filterRpcTools(
    getTools(permissionContext),
    grant.allowedTools,
  )

  if (request.method === 'list_tools') {
    return {
      id: request.id,
      result: availableTools.map(tool => ({
        name: tool.name,
        userFacingName: tool.userFacingName?.({}) ?? tool.name,
      })),
    }
  }

  const requestedToolName =
    typeof request.params?.tool_name === 'string'
      ? normalizeRpcToolName(request.params.tool_name)
      : null

  if (!requestedToolName) {
    return {
      id: request.id,
      error: { code: 'invalid_request', message: 'tool_name is required' },
    }
  }

  const tool = findToolByName(availableTools, requestedToolName)
  if (!tool) {
    return {
      id: request.id,
      error: {
        code: 'forbidden',
        message: `Tool ${requestedToolName} is not allowed for this script`,
      },
    }
  }

  const rawArgs =
    request.params?.args && typeof request.params.args === 'object'
      ? (request.params.args as Record<string, unknown>)
      : {}
  const args = applyLegacyRpcInputAliases(requestedToolName, rawArgs)
  const context = createToolUseContext(permissionContext, availableTools)

  const validation = await tool.validateInput?.(args as never, context)
  if (validation && !validation.result) {
    return {
      id: request.id,
      error: { code: 'invalid_input', message: validation.message },
    }
  }

  const permissionDecision = await tool.checkPermissions(args as never, context)
  if (permissionDecision.behavior !== 'allow') {
    return {
      id: request.id,
      error: {
        code: 'forbidden',
        message: `Permission denied for ${tool.name}`,
      },
    }
  }

  try {
    const result = await tool.call(
      ((permissionDecision.updatedInput ?? args) as never),
      context,
      async nestedTool => {
        return findToolByName(availableTools, nestedTool.name)
          ? { behavior: 'allow' as const }
          : {
              behavior: 'deny' as const,
              message: `Nested tool ${nestedTool.name} is not allowed`,
              errorCode: 1,
            }
      },
      createAssistantMessage({ content: [] }),
    )

    return {
      id: request.id,
      result: result.data,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      id: request.id,
      error: { code: 'tool_error', message },
    }
  }
}

function parseRpcRequest(line: string): RpcRequest {
  return JSON.parse(line) as RpcRequest
}

function writeRpcResponse(socket: Socket, response: RpcResponse): void {
  socket.write(`${jsonStringify(response)}\n`)
}

export async function startToolsSocketServer(socketPath: string): Promise<ToolsSocketServerHandle> {
  await ensureRpcGrantDir()
  await cleanupExpiredRpcGrants()
  await mkdir(dirname(socketPath), { recursive: true })
  await rm(socketPath, { force: true })

  let server: Server | null = createServer(socket => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      buffer += chunk
      while (true) {
        const newlineIndex = buffer.indexOf('\n')
        if (newlineIndex === -1) {
          break
        }

        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line.length === 0) {
          continue
        }

        void executeRpcToolCall(parseRpcRequest(line))
          .then(response => writeRpcResponse(socket, response))
          .catch(error => {
            logError(error)
            writeRpcResponse(socket, {
              id: null,
              error: {
                code: 'internal_error',
                message: error instanceof Error ? error.message : String(error),
              },
            })
          })
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject)
    server?.listen(socketPath, () => resolve())
  })
  await chmod(socketPath, 0o600)

  return {
    socketPath,
    async stop() {
      const activeServer = server
      server = null
      if (activeServer) {
        await new Promise<void>((resolve, reject) => {
          activeServer.close(error => (error ? reject(error) : resolve()))
        })
      }
      await rm(socketPath, { force: true })
    },
  }
}
