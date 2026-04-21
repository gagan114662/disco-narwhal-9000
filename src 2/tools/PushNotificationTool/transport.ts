import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'

export type PushNotificationProvider = 'ntfy' | 'pushover'
export type PushNotificationPriority = 'low' | 'normal' | 'high'

export type PushNotificationSettings = {
  provider: PushNotificationProvider
  ntfyTopic?: string
  pushoverUserKey?: string
  pushoverAppToken?: string
}

export type PushNotificationInput = {
  title: string
  body: string
  priority: PushNotificationPriority
  tag?: string
}

export type PushNotificationDelivery = {
  provider: PushNotificationProvider
  target: string
}

export type FetchLike = typeof fetch

export class PushNotificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PushNotificationError'
  }
}

function getSettings(): { pushNotification?: PushNotificationSettings } {
  return (getSettings_DEPRECATED() || {}) as {
    pushNotification?: PushNotificationSettings
  }
}

export function getPushNotificationSettings(): PushNotificationSettings {
  const settings = getSettings().pushNotification
  if (!settings?.provider) {
    throw new PushNotificationError(
      'Push notifications are not configured. Set `pushNotification.provider` to `"ntfy"` or `"pushover"` in your settings.',
    )
  }
  if (settings.provider === 'ntfy' && !settings.ntfyTopic) {
    throw new PushNotificationError(
      'Push notifications are not configured for ntfy. Set `pushNotification.ntfyTopic` in your settings.',
    )
  }
  if (
    settings.provider === 'pushover' &&
    (!settings.pushoverUserKey || !settings.pushoverAppToken)
  ) {
    throw new PushNotificationError(
      'Push notifications are not configured for Pushover. Set `pushNotification.pushoverUserKey` and `pushNotification.pushoverAppToken` in your settings.',
    )
  }
  return settings
}

function ntfyPriority(priority: PushNotificationPriority): string {
  switch (priority) {
    case 'low':
      return '2'
    case 'high':
      return '4'
    case 'normal':
    default:
      return '3'
  }
}

function ntfyPriorityNumber(priority: PushNotificationPriority): number {
  switch (priority) {
    case 'low':
      return 2
    case 'high':
      return 4
    case 'normal':
    default:
      return 3
  }
}

function pushoverPriority(priority: PushNotificationPriority): string {
  switch (priority) {
    case 'low':
      return '-1'
    case 'high':
      return '1'
    case 'normal':
    default:
      return '0'
  }
}

async function sendNtfyNotification(
  input: PushNotificationInput,
  settings: PushNotificationSettings & { provider: 'ntfy'; ntfyTopic: string },
  fetcher: FetchLike,
): Promise<PushNotificationDelivery> {
  const response = await fetcher('https://ntfy.sh/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic: settings.ntfyTopic,
      title: input.title,
      message: input.body,
      priority: ntfyPriorityNumber(input.priority),
      ...(input.tag ? { tags: [input.tag] } : {}),
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new PushNotificationError(
      `ntfy delivery failed (${response.status} ${response.statusText}): ${body || 'empty response body'}`,
    )
  }

  return {
    provider: 'ntfy',
    target: settings.ntfyTopic,
  }
}

async function sendPushoverNotification(
  input: PushNotificationInput,
  settings: PushNotificationSettings & {
    provider: 'pushover'
    pushoverUserKey: string
    pushoverAppToken: string
  },
  fetcher: FetchLike,
): Promise<PushNotificationDelivery> {
  const params = new URLSearchParams({
    token: settings.pushoverAppToken,
    user: settings.pushoverUserKey,
    title: input.tag ? `${input.tag} ${input.title}` : input.title,
    message: input.body,
    priority: pushoverPriority(input.priority),
  })

  const response = await fetcher('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new PushNotificationError(
      `Pushover delivery failed (${response.status} ${response.statusText}): ${body || 'empty response body'}`,
    )
  }

  return {
    provider: 'pushover',
    target: settings.pushoverUserKey,
  }
}

export async function sendPushNotification(
  input: PushNotificationInput,
  fetcher: FetchLike = fetch,
): Promise<PushNotificationDelivery> {
  const settings = getPushNotificationSettings()
  if (settings.provider === 'ntfy') {
    return sendNtfyNotification(
      input,
      settings as PushNotificationSettings & {
        provider: 'ntfy'
        ntfyTopic: string
      },
      fetcher,
    )
  }
  return sendPushoverNotification(
    input,
    settings as PushNotificationSettings & {
      provider: 'pushover'
      pushoverUserKey: string
      pushoverAppToken: string
    },
    fetcher,
  )
}
