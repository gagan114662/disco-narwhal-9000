import { describe, expect, test } from 'bun:test'
import {
  TelegramApiError,
  TelegramTransportError,
  createTelegramTransport,
} from './transport.js'

type FetchCall = { url: string; init: RequestInit }

function makeFetcher(
  responder: (call: FetchCall) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>,
): { fetcher: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    const call = { url, init: init ?? {} }
    calls.push(call)
    const result = await responder(call)
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { fetcher, calls }
}

describe('createTelegramTransport', () => {
  test('getMe returns the parsed bot user on ok=true', async () => {
    const { fetcher, calls } = makeFetcher(() => ({
      body: {
        ok: true,
        result: { id: 42, is_bot: true, first_name: 'magnus', username: 'magnusbot' },
      },
    }))
    const transport = createTelegramTransport('tok', { fetcher })

    const me = await transport.getMe()

    expect(me).toEqual({ id: 42, is_bot: true, first_name: 'magnus', username: 'magnusbot' })
    expect(calls[0].url).toBe('https://api.telegram.org/bottok/getMe')
    expect(calls[0].init.method).toBe('POST')
  })

  test('getUpdates passes offset/timeout in the request body', async () => {
    const { fetcher, calls } = makeFetcher(() => ({
      body: { ok: true, result: [] },
    }))
    const transport = createTelegramTransport('tok', { fetcher })

    await transport.getUpdates({ offset: 17, timeout: 30 })

    expect(JSON.parse(String(calls[0].init.body))).toEqual({ offset: 17, timeout: 30 })
  })

  test('sendMessage throws TelegramApiError when the bot API returns ok=false', async () => {
    const { fetcher } = makeFetcher(() => ({
      body: { ok: false, description: 'Forbidden: bot was blocked by the user', error_code: 403 },
    }))
    const transport = createTelegramTransport('tok', { fetcher })

    await expect(transport.sendMessage({ chat_id: 1, text: 'hi' })).rejects.toBeInstanceOf(
      TelegramApiError,
    )
  })

  test('network failures bubble up as TelegramTransportError', async () => {
    const fetcher: typeof fetch = async () => {
      throw new Error('ECONNRESET')
    }
    const transport = createTelegramTransport('tok', { fetcher })

    await expect(transport.getMe()).rejects.toBeInstanceOf(TelegramTransportError)
  })

  test('malformed JSON surfaces as TelegramTransportError', async () => {
    const fetcher: typeof fetch = async () =>
      new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } })
    const transport = createTelegramTransport('tok', { fetcher })

    await expect(transport.getMe()).rejects.toBeInstanceOf(TelegramTransportError)
  })

  test('signal is forwarded so abort cancels the in-flight request', async () => {
    const controller = new AbortController()
    const { fetcher, calls } = makeFetcher(() => ({ body: { ok: true, result: [] } }))
    const transport = createTelegramTransport('tok', { fetcher, signal: controller.signal })

    await transport.getUpdates({ timeout: 30 })

    expect(calls[0].init.signal).toBe(controller.signal)
  })
})
