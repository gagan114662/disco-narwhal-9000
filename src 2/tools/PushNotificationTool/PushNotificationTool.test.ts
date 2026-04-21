import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { getPushNotificationSettings, sendPushNotification } from './transport.js'

const ORIGINAL_FETCH = globalThis.fetch
const TEMP_DIRS: string[] = []

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  delete process.env.CLAUDE_CONFIG_DIR
  resetSettingsCache()
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeSettingsDir(settings: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'push-notification-test-'))
  TEMP_DIRS.push(dir)
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings))
  return dir
}

describe('PushNotification transport', () => {
  test('sends ntfy notification on happy path', async () => {
    const dir = makeSettingsDir({
      pushNotification: {
        provider: 'ntfy',
        ntfyTopic: 'kairos-gagan-test',
      },
    })
    process.env.CLAUDE_CONFIG_DIR = dir

    const fetcher = mock(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://ntfy.sh/')
        expect(init?.method).toBe('POST')
        expect(init?.headers).toEqual({
          'Content-Type': 'application/json',
        })
        expect(JSON.parse(String(init?.body))).toEqual({
          topic: 'kairos-gagan-test',
          title: 'hello',
          message: 'this is a test from the new tool',
          priority: 4,
          tags: ['🚨'],
        })
        return new Response('', { status: 200 })
      },
    )

    const result = await sendPushNotification(
      {
        title: 'hello',
        body: 'this is a test from the new tool',
        priority: 'high',
        tag: '🚨',
      },
      fetcher,
    )

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      provider: 'ntfy',
      target: 'kairos-gagan-test',
    })
  })

  test('throws a clear error when settings are missing', () => {
    const dir = makeSettingsDir({})
    process.env.CLAUDE_CONFIG_DIR = dir

    expect(() => getPushNotificationSettings()).toThrow(
      'Push notifications are not configured. Set `pushNotification.provider` to `"ntfy"` or `"pushover"` in your settings.',
    )
  })

  test('surfaces upstream http failures', async () => {
    const dir = makeSettingsDir({
      pushNotification: {
        provider: 'ntfy',
        ntfyTopic: 'kairos-gagan-test',
      },
    })
    process.env.CLAUDE_CONFIG_DIR = dir

    const fetcher = mock(
      async () =>
        new Response('boom', {
          status: 503,
          statusText: 'Service Unavailable',
        }),
    )

    expect(
      sendPushNotification(
        {
          title: 'hello',
          body: 'this is a test from the new tool',
          priority: 'normal',
        },
        fetcher,
      ),
    ).rejects.toThrow(
      'ntfy delivery failed (503 Service Unavailable): boom',
    )
  })
})
