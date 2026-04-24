import { describe, expect, test } from 'bun:test'
import {
  buildMissedTaskNotification,
  forkSession,
  tool,
} from './agentSdkTypes.js'

describe('Agent SDK compatibility facade', () => {
  test('creates SDK tool definitions instead of throwing placeholder errors', () => {
    const definition = tool(
      'demo',
      'Demo tool',
      {},
      async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      { searchHint: 'demo search' },
    )

    expect(definition.name).toBe('demo')
    expect(definition.description).toBe('Demo tool')
    expect(definition.inputSchema).toEqual({})
    expect((definition as { searchHint?: string }).searchHint).toBe(
      'demo search',
    )
  })

  test('formats missed scheduled task notifications', () => {
    const message = buildMissedTaskNotification([
      {
        id: 'task-1',
        cron: '30 14 24 4 *',
        prompt: 'check deploy status',
        createdAt: Date.UTC(2026, 3, 24, 14, 0),
      },
    ])

    expect(message).toContain('one-shot scheduled task was missed')
    expect(message).toContain('AskUserQuestion')
    expect(message).toContain('check deploy status')
  })

  test('unsupported SDK surfaces fail with explicit rebuild context', async () => {
    await expect(forkSession('missing-session')).rejects.toThrow(
      'rebuilt CLI distribution',
    )
  })
})
