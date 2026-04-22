import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import { getKairosRpcConfig } from '../../services/rpc/config.js'
import { startToolsSocketServer } from '../../services/rpc/toolsSocketServer.js'
import { getTools } from '../../tools.js'
import { runScriptProcess } from './RunScriptTool.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

const TEMP_DIRS: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  resetSettingsCache()
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('RunScriptTool', () => {
  test('runs a subprocess that uses the Python RPC client', async () => {
    const configDir = makeTempDir('kairos-run-script-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({ kairos: { rpc: { enabled: true } } }),
    )
    resetSettingsCache()

    const config = getKairosRpcConfig()
    const server = await startToolsSocketServer(config.socketPath)
    const tempFile = join(configDir, 'rpc-example.txt')
    writeFileSync(tempFile, 'hello from rpc\n')

    const context = {
      abortController: new AbortController(),
      options: {
        commands: [],
        debug: false,
        mainLoopModel: 'sonnet',
        tools: getTools(getDefaultAppState().toolPermissionContext),
        verbose: false,
        thinkingConfig: { type: 'disabled' as const },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: { activeAgents: [], allAgents: [] },
      },
      readFileState: createFileStateCacheWithSizeLimit(16),
      getAppState: () => {
        const state = getDefaultAppState()
        state.toolPermissionContext.additionalWorkingDirectories = new Map([
          [configDir, { path: configDir, source: 'session' }],
        ])
        return state
      },
      setAppState: () => {},
      messages: [],
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
    }

    const result = await runScriptProcess(
      {
        script: `python3 -c "import sys; sys.path.insert(0, '${join(process.cwd(), 'services', 'rpc', 'python_client')}'); import kairos_tools; print(kairos_tools.call('ReadFile', {'path': '${tempFile}'})['file']['content'])"`,
      },
      context as never,
    )

    expect(result.stdout).toContain('hello from rpc')

    await server.stop()
  })

  test('returns stderr for a crashing script', async () => {
    const configDir = makeTempDir('kairos-run-script-crash-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({ kairos: { rpc: { enabled: true } } }),
    )
    resetSettingsCache()

    const context = {
      abortController: new AbortController(),
      options: {
        commands: [],
        debug: false,
        mainLoopModel: 'sonnet',
        tools: getTools(getDefaultAppState().toolPermissionContext),
        verbose: false,
        thinkingConfig: { type: 'disabled' as const },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: { activeAgents: [], allAgents: [] },
      },
      readFileState: createFileStateCacheWithSizeLimit(16),
      getAppState: () => getDefaultAppState(),
      setAppState: () => {},
      messages: [],
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
    }

    await expect(
      runScriptProcess(
        {
          script: `python3 -c "import sys; sys.stderr.write('boom\\n'); sys.exit(3)"`,
        },
        context as never,
      ),
    ).rejects.toThrow('boom')
  })

  test('terminates a script that exceeds its timeout', async () => {
    const configDir = makeTempDir('kairos-run-script-timeout-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({ kairos: { rpc: { enabled: true } } }),
    )
    resetSettingsCache()

    const context = {
      abortController: new AbortController(),
      options: {
        commands: [],
        debug: false,
        mainLoopModel: 'sonnet',
        tools: getTools(getDefaultAppState().toolPermissionContext),
        verbose: false,
        thinkingConfig: { type: 'disabled' as const },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: { activeAgents: [], allAgents: [] },
      },
      readFileState: createFileStateCacheWithSizeLimit(16),
      getAppState: () => getDefaultAppState(),
      setAppState: () => {},
      messages: [],
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
    }

    await expect(
      runScriptProcess(
        {
          script: `python3 -c "import time; time.sleep(2)"`,
          timeoutSec: 1,
        },
        context as never,
      ),
    ).rejects.toThrow()
  })

  test('truncates oversized stdout', async () => {
    const configDir = makeTempDir('kairos-run-script-stdout-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({ kairos: { rpc: { enabled: true } } }),
    )
    resetSettingsCache()

    const context = {
      abortController: new AbortController(),
      options: {
        commands: [],
        debug: false,
        mainLoopModel: 'sonnet',
        tools: getTools(getDefaultAppState().toolPermissionContext),
        verbose: false,
        thinkingConfig: { type: 'disabled' as const },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: { activeAgents: [], allAgents: [] },
      },
      readFileState: createFileStateCacheWithSizeLimit(16),
      getAppState: () => getDefaultAppState(),
      setAppState: () => {},
      messages: [],
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
    }

    const result = await runScriptProcess(
      {
        script: `python3 -c "print('x' * 20000)"`,
      },
      context as never,
    )

    expect(result.truncated).toBe(true)
    expect(result.stdout.length).toBeLessThanOrEqual(16 * 1024)
  })
})
