// Thin fetch-based client for the Telegram Bot API.
//
// We deliberately avoid `@grammyjs/grammy` and `node-telegram-bot-api` —
// the Bot API endpoints we need are a trivial subset (getMe, getUpdates,
// sendMessage) and a 90-line wrapper is easier to stub in tests than
// monkey-patching a full SDK.
//
// Errors: the Bot API returns `{ ok: false, description, error_code }` on
// failure with HTTP 200, so we normalize that into a thrown
// TelegramApiError. Network / 5xx / malformed-body errors surface as
// TelegramTransportError so the caller can distinguish "we couldn't reach
// Telegram" from "Telegram told us no".

export type TelegramUser = {
  id: number
  is_bot: boolean
  first_name: string
  username?: string
}

export type TelegramChat = {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  username?: string
  first_name?: string
}

export type TelegramMessage = {
  message_id: number
  date: number
  chat: TelegramChat
  from?: TelegramUser
  text?: string
}

export type TelegramUpdate = {
  update_id: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
}

export type GetUpdatesParams = {
  offset?: number
  timeout?: number
  limit?: number
  allowed_updates?: string[]
}

export type SendMessageParams = {
  chat_id: number
  text: string
  disable_notification?: boolean
}

export type FetchLike = typeof fetch

export class TelegramApiError extends Error {
  readonly errorCode: number
  constructor(errorCode: number, description: string) {
    super(`Telegram API error ${errorCode}: ${description}`)
    this.name = 'TelegramApiError'
    this.errorCode = errorCode
  }
}

export class TelegramTransportError extends Error {
  readonly cause?: unknown
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'TelegramTransportError'
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

export type TelegramTransport = {
  getMe(): Promise<TelegramUser>
  getUpdates(params: GetUpdatesParams): Promise<TelegramUpdate[]>
  sendMessage(params: SendMessageParams): Promise<TelegramMessage>
}

type TransportDeps = {
  baseUrl?: string
  fetcher?: FetchLike
  /** Abort signal forwarded to every request. Long-poll callers pass it so
   * stopping the gateway cancels an in-flight getUpdates immediately. */
  signal?: AbortSignal
}

const DEFAULT_BASE_URL = 'https://api.telegram.org'

export function createTelegramTransport(
  token: string,
  deps: TransportDeps = {},
): TelegramTransport {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL
  const fetcher = deps.fetcher ?? fetch
  const signal = deps.signal

  async function call<T>(method: string, body: unknown): Promise<T> {
    const url = `${baseUrl}/bot${token}/${method}`
    let response: Response
    try {
      response = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal,
      })
    } catch (error) {
      throw new TelegramTransportError(
        `network error calling ${method}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }

    let parsed: { ok: boolean; result?: T; description?: string; error_code?: number }
    try {
      parsed = (await response.json()) as typeof parsed
    } catch (error) {
      throw new TelegramTransportError(
        `malformed JSON from ${method} (status ${response.status})`,
        { cause: error },
      )
    }

    if (!parsed.ok) {
      throw new TelegramApiError(
        parsed.error_code ?? response.status,
        parsed.description ?? 'unknown error',
      )
    }
    return parsed.result as T
  }

  return {
    getMe: () => call<TelegramUser>('getMe', {}),
    getUpdates: params => call<TelegramUpdate[]>('getUpdates', params),
    sendMessage: params => call<TelegramMessage>('sendMessage', params),
  }
}
