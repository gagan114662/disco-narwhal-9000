import { createRequire } from 'module'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'

type BrowserTool = { name: string }

type ClaudeForChromeMcpServer = {
  connect: (...args: unknown[]) => Promise<void>
}

type ClaudeForChromePackage = {
  BROWSER_TOOLS?: BrowserTool[]
  createClaudeForChromeMcpServer?: (
    context: unknown,
  ) => ClaudeForChromeMcpServer
}

const require = createRequire(import.meta.url)
let packageLoadAttempted = false
let packageCache: ClaudeForChromePackage | undefined

function loadClaudeForChromePackage(): ClaudeForChromePackage | undefined {
  if (packageLoadAttempted) {
    return packageCache
  }
  packageLoadAttempted = true

  try {
    packageCache = require(
      '@ant/claude-for-chrome-mcp',
    ) as ClaudeForChromePackage
  } catch (error) {
    logForDebugging(
      `[Claude in Chrome] optional package unavailable: ${errorMessage(error)}`,
    )
    packageCache = undefined
  }

  return packageCache
}

export function getBrowserTools(): BrowserTool[] {
  return loadClaudeForChromePackage()?.BROWSER_TOOLS ?? []
}

export function createClaudeForChromeMcpServerFromOptionalPackage(
  context: unknown,
): ClaudeForChromeMcpServer {
  const createServer =
    loadClaudeForChromePackage()?.createClaudeForChromeMcpServer
  if (!createServer) {
    throw new Error(
      'Claude in Chrome support requires @ant/claude-for-chrome-mcp to be installed',
    )
  }
  return createServer(context)
}
