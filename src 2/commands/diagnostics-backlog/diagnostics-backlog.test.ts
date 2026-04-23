import { describe, expect, test } from 'bun:test'
import { call, parseDiagnosticsBacklogMode } from './diagnostics-backlog.js'

describe('/diagnostics-backlog mode parsing', () => {
  test('accepts known modes and defaults to current', () => {
    expect(parseDiagnosticsBacklogMode('')).toBe('current')
    expect(parseDiagnosticsBacklogMode('current')).toBe('current')
    expect(parseDiagnosticsBacklogMode('snapshot')).toBe('snapshot')
    expect(parseDiagnosticsBacklogMode('new')).toBe('new')
    expect(parseDiagnosticsBacklogMode('bogus')).toBeNull()
  })
})

describe('/diagnostics-backlog command', () => {
  test('returns usage for invalid args', async () => {
    const result = await call('bogus', {
      options: { mcpClients: [] },
    } as never)

    expect(result.type).toBe('text')
    if (result.type !== 'text') return
    expect(result.value).toContain('Usage: /diagnostics-backlog')
  })

  test('reports missing IDE connectivity clearly', async () => {
    const result = await call('', {
      options: { mcpClients: [] },
    } as never)

    expect(result.type).toBe('text')
    if (result.type !== 'text') return
    expect(result.value).toContain('No connected IDE diagnostics client')
  })

  test('asks for a snapshot before diffing new diagnostics', async () => {
    const result = await call('new', {
      options: {
        mcpClients: [
          {
            type: 'connected',
            name: 'ide',
          },
        ],
      },
    } as never)

    expect(result.type).toBe('text')
    if (result.type !== 'text') return
    expect(result.value).toContain('Run `/diagnostics-backlog snapshot` first')
  })
})
