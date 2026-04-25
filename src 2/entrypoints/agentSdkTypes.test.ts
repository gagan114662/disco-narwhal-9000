import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildMissedTaskNotification,
  forkSession,
  getSessionInfo,
  getSessionMessages,
  tool,
  watchScheduledTasks,
} from './agentSdkTypes.js'
import { getProjectDir } from '../utils/sessionStoragePortable.js'

const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (ORIGINAL_CLAUDE_CONFIG_DIR === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR
  }
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function writeSessionFixture(
  sessionId: string,
  projectDir: string,
  entries: unknown[],
): void {
  const transcriptDir = getProjectDir(projectDir)
  mkdirSync(transcriptDir, { recursive: true })
  writeFileSync(
    join(transcriptDir, `${sessionId}.jsonl`),
    entries.map(entry => JSON.stringify(entry)).join('\n') + '\n',
  )
}

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

  test('reads session messages from transcript storage', async () => {
    const configDir = tempDir('agent-sdk-config-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    const projectDir = realpathSync(tempDir('agent-sdk-project-'))
    const sessionId = '11111111-1111-4111-8111-111111111111'
    writeSessionFixture(sessionId, projectDir, [
      {
        type: 'system',
        subtype: 'init',
        uuid: '22222222-2222-4222-8222-222222222222',
        parentUuid: null,
        timestamp: '2026-04-24T10:00:00.000Z',
        sessionId,
        isSidechain: false,
      },
      {
        type: 'user',
        uuid: '33333333-3333-4333-8333-333333333333',
        parentUuid: '22222222-2222-4222-8222-222222222222',
        timestamp: '2026-04-24T10:01:00.000Z',
        sessionId,
        isSidechain: false,
        message: { role: 'user', content: 'hello' },
      },
      {
        type: 'assistant',
        uuid: '44444444-4444-4444-8444-444444444444',
        parentUuid: '33333333-3333-4333-8333-333333333333',
        timestamp: '2026-04-24T10:02:00.000Z',
        sessionId,
        isSidechain: false,
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      },
    ])

    const messages = await getSessionMessages(sessionId, { dir: projectDir })
    expect(messages.map(message => message.type)).toEqual(['user', 'assistant'])

    const withSystem = await getSessionMessages(sessionId, {
      dir: projectDir,
      includeSystemMessages: true,
    })
    expect(withSystem.map(message => message.type)).toEqual([
      'system',
      'user',
      'assistant',
    ])

    const second = await getSessionMessages(sessionId, {
      dir: projectDir,
      offset: 1,
      limit: 1,
    })
    expect(second.map(message => message.type)).toEqual(['assistant'])
  })

  test('forks sessions with fresh message UUIDs', async () => {
    const configDir = tempDir('agent-sdk-config-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    const projectDir = realpathSync(tempDir('agent-sdk-project-'))
    const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const userUuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const assistantUuid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    writeSessionFixture(sessionId, projectDir, [
      {
        type: 'user',
        uuid: userUuid,
        parentUuid: null,
        timestamp: '2026-04-24T11:01:00.000Z',
        sessionId,
        isSidechain: false,
        message: { role: 'user', content: 'branch me' },
      },
      {
        type: 'assistant',
        uuid: assistantUuid,
        parentUuid: userUuid,
        timestamp: '2026-04-24T11:02:00.000Z',
        sessionId,
        isSidechain: false,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'branched' }],
        },
      },
      {
        type: 'content-replacement',
        sessionId,
        replacements: [
          {
            kind: 'tool-result',
            toolUseId: 'toolu_123',
            replacement: '[tool result omitted]',
          },
        ],
      },
    ])

    const result = await forkSession(sessionId, {
      dir: projectDir,
      title: 'Branch title',
    })

    expect(result.sessionId).not.toBe(sessionId)
    const messages = await getSessionMessages(result.sessionId, {
      dir: projectDir,
    })
    expect(messages.map(message => message.type)).toEqual(['user', 'assistant'])
    expect(messages.map(message => message.sessionId)).toEqual([
      result.sessionId,
      result.sessionId,
    ])
    expect(messages.map(message => message.uuid)).not.toEqual([
      userUuid,
      assistantUuid,
    ])
    expect(messages[1]!.parentUuid).toBe(messages[0]!.uuid)

    const info = await getSessionInfo(result.sessionId, { dir: projectDir })
    expect(info?.customTitle).toBe('Branch title')

    const forkContent = readFileSync(
      join(getProjectDir(projectDir), `${result.sessionId}.jsonl`),
      'utf8',
    )
    const forkEntries = forkContent
      .trim()
      .split('\n')
      .map(
        line => JSON.parse(line) as { type: string; replacements?: unknown[] },
      )
    const replacementEntry = forkEntries.find(
      entry => entry.type === 'content-replacement',
    )
    expect(replacementEntry?.replacements).toEqual([
      {
        kind: 'tool-result',
        toolUseId: 'toolu_123',
        replacement: '[tool result omitted]',
      },
    ])
  })

  test('unsupported SDK surfaces fail with explicit rebuild context', () => {
    expect(() =>
      watchScheduledTasks({
        dir: process.cwd(),
        signal: new AbortController().signal,
      }),
    ).toThrow('rebuilt CLI distribution')
  })
})
