import { describe, expect, test } from 'bun:test'
import {
  createDispatcher,
  parseCommand,
  parseReminderWhen,
} from './commands.js'

function makeDeps(overrides: Partial<Parameters<typeof createDispatcher>[0]> = {}) {
  const calls: { setPause: boolean[]; skip: number } = { setPause: [], skip: 0 }
  const deps = {
    now: () => new Date('2026-04-22T12:00:00.000Z'),
    readStatus: async () => ({ state: 'idle', pid: 1234 }),
    readPause: async () => ({ paused: false }),
    listProjects: async () => ['/tmp/project-a'],
    setPause: async (p: boolean) => {
      calls.setPause.push(p)
    },
    scheduleReminder: async (req: { projectDir: string; text: string; at: unknown }) => ({
      ok: true as const,
      status: 'scheduled' as const,
      id: 'abc',
      at: req.at as Date,
      text: req.text,
      projectDir: req.projectDir,
      filePath: '',
      message: `Reminder scheduled for ${String(req.at)}: "${req.text}".`,
    }),
    recordSkip: async () => {
      calls.skip += 1
    },
    ...overrides,
  }
  const dispatcher = createDispatcher(deps as Parameters<typeof createDispatcher>[0])
  return { dispatcher, calls, deps }
}

describe('parseCommand', () => {
  test.each([
    ['/status', 'status'],
    ['/Status', 'status'],
    ['/pause', 'pause'],
    ['/resume', 'resume'],
    ['/remind 2m hydrate', 'remind'],
    ['/skip', 'skip'],
    ['/help', 'help'],
    ['/start', 'help'],
    ['/status@magnus114bot', 'status'],
  ] as const)('recognizes %s as %s', (input, expected) => {
    expect(parseCommand(input).name).toBe(expected)
  })

  test('non-slash input returns unknown', () => {
    expect(parseCommand('hello').name).toBe('unknown')
  })

  test('unrecognized slash command returns unknown', () => {
    expect(parseCommand('/foo bar').name).toBe('unknown')
  })

  test('preserves argument rest', () => {
    expect(parseCommand('/remind 2m drink water').rest).toBe('2m drink water')
  })
})

describe('parseReminderWhen', () => {
  const now = new Date('2026-04-22T12:00:00.000Z')

  test.each([
    ['2m', 2 * 60 * 1000],
    ['90s', 90 * 1000],
    ['1h', 60 * 60 * 1000],
    ['2 hours', 2 * 60 * 60 * 1000],
    ['1d', 24 * 60 * 60 * 1000],
  ] as const)('%s resolves to +%dms', (token, expectedMs) => {
    const result = parseReminderWhen(token, now)
    expect(result?.getTime()).toBe(now.getTime() + expectedMs)
  })

  test('absolute ISO timestamp parses', () => {
    const result = parseReminderWhen('2026-05-01T09:00:00.000Z', now)
    expect(result?.toISOString()).toBe('2026-05-01T09:00:00.000Z')
  })

  test('returns null for free-form English (to avoid misreading)', () => {
    expect(parseReminderWhen('tomorrow at 9', now)).toBeNull()
  })

  test('returns null for zero or negative durations', () => {
    expect(parseReminderWhen('0m', now)).toBeNull()
  })

  test('returns null for empty input', () => {
    expect(parseReminderWhen('', now)).toBeNull()
  })
})

describe('createDispatcher', () => {
  test('/status renders a compact summary', async () => {
    const { dispatcher } = makeDeps()
    const { reply } = await dispatcher.dispatch({ chatId: 1, text: '/status' })
    expect(reply).toContain('daemon: idle')
    expect(reply).toContain('paused: no')
    expect(reply).toContain('projects: 1')
  })

  test('/pause flips state via setPause(true)', async () => {
    const { dispatcher, calls } = makeDeps()
    await dispatcher.dispatch({ chatId: 1, text: '/pause' })
    expect(calls.setPause).toEqual([true])
  })

  test('/resume flips state via setPause(false)', async () => {
    const { dispatcher, calls } = makeDeps()
    await dispatcher.dispatch({ chatId: 1, text: '/resume' })
    expect(calls.setPause).toEqual([false])
  })

  test('/remind with valid args schedules and echoes confirmation', async () => {
    const { dispatcher } = makeDeps()
    const { reply } = await dispatcher.dispatch({
      chatId: 1,
      text: '/remind 2m drink water',
    })
    expect(reply).toContain('Reminder scheduled for')
    expect(reply).toContain('drink water')
  })

  test('/remind rejects missing "what"', async () => {
    const { dispatcher } = makeDeps()
    const { reply } = await dispatcher.dispatch({ chatId: 1, text: '/remind 2m' })
    expect(reply.toLowerCase()).toContain('usage')
  })

  test('/remind rejects ambiguous "when"', async () => {
    const { dispatcher } = makeDeps()
    const { reply } = await dispatcher.dispatch({
      chatId: 1,
      text: '/remind later drink water',
    })
    expect(reply.toLowerCase()).toContain("couldn't parse")
  })

  test('/remind errors when no projects are opted in', async () => {
    const { dispatcher } = makeDeps({ listProjects: async () => [] })
    const { reply } = await dispatcher.dispatch({
      chatId: 1,
      text: '/remind 2m drink water',
    })
    expect(reply.toLowerCase()).toContain('opt-in')
  })

  test('/skip records and acknowledges', async () => {
    const { dispatcher, calls } = makeDeps()
    const { reply } = await dispatcher.dispatch({ chatId: 1, text: '/skip' })
    expect(calls.skip).toBe(1)
    expect(reply.toLowerCase()).toContain('dismissed')
  })

  test('/help lists available commands', async () => {
    const { dispatcher } = makeDeps()
    const { reply } = await dispatcher.dispatch({ chatId: 1, text: '/help' })
    expect(reply).toContain('/status')
    expect(reply).toContain('/remind')
  })

  test('unknown command returns help text', async () => {
    const { dispatcher } = makeDeps()
    const { reply } = await dispatcher.dispatch({ chatId: 1, text: '/foo' })
    expect(reply.toLowerCase()).toContain('unknown')
  })
})
