import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { createConnection } from 'net'
import { join } from 'path'
import { tmpdir } from 'os'
import { getKairosRpcConfig } from './config.js'
import { createRpcGrant, deleteRpcGrant } from './authToken.js'
import { startToolsSocketServer } from './toolsSocketServer.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

const TEMP_DIRS: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

async function rpcRequest(
  socketPath: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const socket = createConnection(socketPath)
  const response = await new Promise<string>((resolve, reject) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.once('error', reject)
    socket.on('data', data => {
      buffer += data
      const newline = buffer.indexOf('\n')
      if (newline !== -1) {
        resolve(buffer.slice(0, newline))
      }
    })
    socket.once('connect', () => {
      socket.write(`${JSON.stringify(body)}\n`)
    })
  })
  socket.end()
  return JSON.parse(response) as Record<string, unknown>
}

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  resetSettingsCache()
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('KAIROS RPC server', () => {
  test('defaults off until enabled in settings', () => {
    const configDir = makeTempDir('kairos-rpc-config-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    expect(getKairosRpcConfig().enabled).toBe(false)

    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({ kairos: { rpc: { enabled: true } } }),
    )
    resetSettingsCache()
    expect(getKairosRpcConfig().enabled).toBe(true)
  })

  test('enforces auth token and allowlist', async () => {
    const configDir = makeTempDir('kairos-rpc-auth-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({ kairos: { rpc: { enabled: true } } }),
    )
    resetSettingsCache()

    const { socketPath } = getKairosRpcConfig()
    const server = await startToolsSocketServer(socketPath)
    const permissionContext = getEmptyToolPermissionContext()
    const grant = await createRpcGrant({
      projectDir: process.cwd(),
      allowedTools: ['Read'],
      permissionContext,
      maxCalls: 500,
      expiresAt: new Date(Date.now() + 60_000),
    })

    try {
      const missingAuth = await rpcRequest(socketPath, {
        id: 1,
        method: 'list_tools',
        params: {},
      })
      expect(missingAuth.error).toBeDefined()

      const tools = await rpcRequest(socketPath, {
        id: 2,
        method: 'list_tools',
        params: { token: grant.token },
      })
      expect((tools.result as Array<{ name: string }>).map(item => item.name)).toEqual(['Read'])

      const forbidden = await rpcRequest(socketPath, {
        id: 3,
        method: 'call_tool',
        params: {
          token: grant.token,
          tool_name: 'Glob',
          args: { pattern: '*.ts' },
        },
      })
      expect(forbidden.error).toBeDefined()
    } finally {
      await deleteRpcGrant(grant.token)
      await server.stop()
    }
  })

  test('enforces the per-grant rpc rate limit', async () => {
    const configDir = makeTempDir('kairos-rpc-rate-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({ kairos: { rpc: { enabled: true } } }),
    )
    resetSettingsCache()

    const { socketPath } = getKairosRpcConfig()
    const server = await startToolsSocketServer(socketPath)
    const grant = await createRpcGrant({
      projectDir: process.cwd(),
      allowedTools: ['Read'],
      permissionContext: getEmptyToolPermissionContext(),
      maxCalls: 1,
      expiresAt: new Date(Date.now() + 60_000),
    })

    try {
      const first = await rpcRequest(socketPath, {
        id: 1,
        method: 'list_tools',
        params: { token: grant.token },
      })
      expect(first.result).toBeDefined()

      const second = await rpcRequest(socketPath, {
        id: 2,
        method: 'list_tools',
        params: { token: grant.token },
      })
      expect(second.error).toBeDefined()
    } finally {
      await deleteRpcGrant(grant.token)
      await server.stop()
    }
  })
})
