import { afterEach, describe, expect, test } from 'bun:test'
import type { ScopedMcpServerConfig } from './types.js'
import {
  areMcpConfigsEqual,
  getMcpServerConnectionBatchSize,
  getServerCacheKey,
  inferCompactSchema,
  isMcpSessionExpiredError,
  mcpToolInputToAutoClassifierInput,
} from './client.js'

const ORIGINAL_BATCH_SIZE = process.env.MCP_SERVER_CONNECTION_BATCH_SIZE

afterEach(() => {
  if (ORIGINAL_BATCH_SIZE === undefined) {
    delete process.env.MCP_SERVER_CONNECTION_BATCH_SIZE
  } else {
    process.env.MCP_SERVER_CONNECTION_BATCH_SIZE = ORIGINAL_BATCH_SIZE
  }
})

function makeHttpConfig(
  overrides: Partial<ScopedMcpServerConfig> = {},
): ScopedMcpServerConfig {
  return {
    scope: 'project',
    type: 'http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer token' },
    ...overrides,
  } as ScopedMcpServerConfig
}

describe('MCP client helpers', () => {
  test('recognizes session-expired 404 errors from MCP servers', () => {
    const expired = Object.assign(
      new Error('{"error":{"code":-32001,"message":"Session not found"}}'),
      { code: 404 },
    )
    const generic404 = Object.assign(new Error('Not found'), { code: 404 })

    expect(isMcpSessionExpiredError(expired)).toBe(true)
    expect(isMcpSessionExpiredError(generic404)).toBe(false)
    expect(isMcpSessionExpiredError(new Error('{"error":{"code":-32001}}'))).toBe(
      false,
    )
  })

  test('uses the default MCP connection batch size unless overridden', () => {
    delete process.env.MCP_SERVER_CONNECTION_BATCH_SIZE
    expect(getMcpServerConnectionBatchSize()).toBe(3)

    process.env.MCP_SERVER_CONNECTION_BATCH_SIZE = '7'
    expect(getMcpServerConnectionBatchSize()).toBe(7)
  })

  test('compares MCP configs while ignoring scope metadata', () => {
    const projectConfig = makeHttpConfig({ scope: 'project' })
    const localConfig = makeHttpConfig({ scope: 'local' })
    const changedConfig = makeHttpConfig({
      headers: { Authorization: 'Bearer different-token' },
    })

    expect(areMcpConfigsEqual(projectConfig, localConfig)).toBe(true)
    expect(areMcpConfigsEqual(projectConfig, changedConfig)).toBe(false)
  })

  test('builds stable cache keys and classifier inputs', () => {
    const config = makeHttpConfig()

    expect(getServerCacheKey('github', config)).toContain('github-')
    expect(
      mcpToolInputToAutoClassifierInput(
        { path: '/tmp/demo', recursive: true },
        'mcp__fs__read',
      ),
    ).toBe('path=/tmp/demo recursive=true')
    expect(mcpToolInputToAutoClassifierInput({}, 'mcp__fs__read')).toBe(
      'mcp__fs__read',
    )
  })

  test('infers compact schemas for nested MCP result payloads', () => {
    expect(
      inferCompactSchema({
        title: 'Build',
        count: 2,
        items: [{ id: 1, ok: true }],
      }, 3),
    ).toBe('{title: string, count: number, items: [{id: number, ok: boolean}]}')
    expect(inferCompactSchema([], 2)).toBe('[]')
    expect(inferCompactSchema({ deep: { nested: { value: 1 } } }, 1)).toBe(
      '{deep: {...}}',
    )
  })
})
