import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createEventTail, formatEventForTelegram } from './eventTail.js'
import type { OutboundQueue } from './outbound.js'
import type { SendMessageParams, TelegramMessage } from './transport.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempPath(filename: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tg-tail-'))
  TEMP_DIRS.push(dir)
  mkdirSync(dir, { recursive: true })
  return join(dir, filename)
}

function stubQueue(): { queue: OutboundQueue; sent: SendMessageParams[] } {
  const sent: SendMessageParams[] = []
  const queue: OutboundQueue = {
    send: async params => {
      sent.push(params)
      return [] as TelegramMessage[]
    },
    drain: async () => {},
  }
  return { queue, sent }
}

async function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

describe('formatEventForTelegram', () => {
  test('tier3_surface formats with emoji prefix', () => {
    const out = formatEventForTelegram({
      kind: 'tier3_surface',
      message: 'Take a break',
    })
    expect(out).toContain('Take a break')
  })

  test('cap_hit_notice shows cap and current', () => {
    const out = formatEventForTelegram({
      kind: 'cap_hit_notice',
      scope: 'global',
      cap: 10,
      current: 11.25,
    })
    expect(out).toContain('$11.25')
    expect(out).toContain('$10.00')
  })

  test('fired shows the task id', () => {
    expect(formatEventForTelegram({ kind: 'fired', taskId: 'abc' })).toContain('abc')
  })

  test('unrecognized kinds return null', () => {
    expect(formatEventForTelegram({ kind: 'project_registered' })).toBeNull()
  })
})

describe('createEventTail', () => {
  test('forwards newly appended tier3_surface events to every paired chat', async () => {
    const path = makeTempPath('events.jsonl')
    writeFileSync(path, '')

    const { queue, sent } = stubQueue()
    const tail = createEventTail({
      path,
      outboundChatIds: async () => [111, 222],
      outbound: queue,
      startAtOffset: 0,
    })
    await tail.start()

    appendFileSync(
      path,
      `${JSON.stringify({ kind: 'tier3_surface', message: 'Drink water', t: '2026-04-22T12:00:00.000Z' })}\n`,
    )

    await tail.tick()
    await tail.stop()

    expect(sent.length).toBe(2)
    expect(sent[0].text).toContain('Drink water')
    expect(sent.map(s => s.chat_id).sort()).toEqual([111, 222])
  })

  test('skips events with unrecognized kinds', async () => {
    const path = makeTempPath('events.jsonl')
    writeFileSync(path, '')

    const { queue, sent } = stubQueue()
    const tail = createEventTail({
      path,
      outboundChatIds: async () => [111],
      outbound: queue,
      startAtOffset: 0,
    })
    await tail.start()

    appendFileSync(
      path,
      `${JSON.stringify({ kind: 'project_registered', t: 't', projectDir: '/x' })}\n`,
    )
    await tail.tick()
    await tail.stop()

    expect(sent.length).toBe(0)
  })

  test('ignores history written before start when startAtOffset is omitted', async () => {
    const path = makeTempPath('events.jsonl')
    writeFileSync(
      path,
      `${JSON.stringify({ kind: 'tier3_surface', message: 'old' })}\n`,
    )

    const { queue, sent } = stubQueue()
    const tail = createEventTail({
      path,
      outboundChatIds: async () => [111],
      outbound: queue,
    })
    await tail.start()
    await tail.tick()
    await tail.stop()

    expect(sent.length).toBe(0)
  })

  test('handles truncation (file size shrinks)', async () => {
    const path = makeTempPath('events.jsonl')
    writeFileSync(path, '')

    const { queue, sent } = stubQueue()
    const tail = createEventTail({
      path,
      outboundChatIds: async () => [111],
      outbound: queue,
      startAtOffset: 0,
    })
    await tail.start()

    // Write, read, truncate (simulating log rotation), then write again.
    appendFileSync(
      path,
      `${JSON.stringify({ kind: 'tier3_surface', message: 'a long first message to ensure truncation is smaller' })}\n`,
    )
    await tail.tick()
    expect(sent.length).toBe(1)

    writeFileSync(path, `${JSON.stringify({ kind: 'tier3_surface', message: 'after' })}\n`)
    await tail.tick()
    await tail.stop()

    expect(sent.length).toBe(2)
    expect(sent[1].text).toContain('after')
  })
})
