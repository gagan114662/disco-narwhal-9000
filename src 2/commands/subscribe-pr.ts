import type { Command } from '../commands.js'
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../types/command.js'
import { removeCronTasks } from '../utils/cronTasks.js'
import {
  deletePRSubscriptionById,
  getPRSubscriptionByUrl,
  readPRSubscriptions,
  type PRSubscription,
  upsertPRSubscription,
} from '../tools/SubscribePRTool/prStore.js'
import {
  GitHubRateLimitError,
  parsePullRequestUrl,
  pollPullRequest,
} from '../tools/SubscribePRTool/poller.js'
import { subscribeToPullRequest } from '../tools/SubscribePRTool/SubscribePRTool.js'

const HELP_TEXT = `Usage:
/subscribe-pr <url>
/subscribe-pr list
/subscribe-pr remove <url>`

function formatSubscription(subscription: PRSubscription): string {
  const state = subscription.lastState
    ? `${subscription.lastState.state}, checks ${subscription.lastState.checkSummary}, comments ${subscription.lastState.commentCount}`
    : 'not checked yet'
  return [
    subscription.url,
    `  interval: ${subscription.intervalSec}s`,
    `  last checked: ${subscription.lastCheckedAt ?? 'never'}`,
    `  last state: ${state}`,
    `  last event: ${subscription.lastEventSummary ?? 'none'}`,
  ].join('\n')
}

async function maybeSendPushNotification(message: string): Promise<void> {
  try {
    const transport = await import('../tools/PushNotificationTool/transport.js')
    await transport.sendPushNotification({
      title: 'GitHub PR update',
      body: message,
      priority: 'normal',
      tag: 'PR',
    })
  } catch {
    // Optional integration only.
  }
}

function shouldSkipPoll(subscription: PRSubscription, nowMs: number): boolean {
  const lastCheckedMs = subscription.lastCheckedAt
    ? new Date(subscription.lastCheckedAt).getTime()
    : 0
  if (subscription.backoffUntil) {
    const backoffMs = new Date(subscription.backoffUntil).getTime()
    if (Number.isFinite(backoffMs) && backoffMs > nowMs) {
      return true
    }
  }
  return lastCheckedMs > 0 && nowMs - lastCheckedMs < subscription.intervalSec * 1000
}

async function handleList(onDone: LocalJSXCommandOnDone): Promise<void> {
  const subscriptions = await readPRSubscriptions()
  if (subscriptions.length === 0) {
    onDone('No active PR subscriptions.', { display: 'system' })
    return
  }
  onDone(
    subscriptions.map(subscription => formatSubscription(subscription)).join('\n\n'),
    { display: 'system' },
  )
}

async function handleRemove(
  onDone: LocalJSXCommandOnDone,
  rawUrl: string,
): Promise<void> {
  const parsed = parsePullRequestUrl(rawUrl)
  if (!parsed) {
    onDone(
      'Invalid GitHub PR URL. Expected https://github.com/owner/repo/pull/N',
      { display: 'system' },
    )
    return
  }

  const subscription = await getPRSubscriptionByUrl(parsed.url)
  if (!subscription) {
    onDone(`No active subscription for ${parsed.url}.`, { display: 'system' })
    return
  }

  await removeCronTasks([subscription.cronTaskId])
  await deletePRSubscriptionById(subscription.id)
  onDone(`Stopped watching ${subscription.url}.`, { display: 'system' })
}

async function handlePoll(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  rawUrl: string,
): Promise<void> {
  const parsed = parsePullRequestUrl(rawUrl)
  if (!parsed) {
    onDone(undefined, { display: 'skip' })
    return
  }

  const subscription = await getPRSubscriptionByUrl(parsed.url)
  if (!subscription) {
    onDone(undefined, { display: 'skip' })
    return
  }

  const nowMs = Date.now()
  if (shouldSkipPoll(subscription, nowMs)) {
    onDone(undefined, { display: 'skip' })
    return
  }

  try {
    const result = await pollPullRequest(subscription)
    const now = new Date(nowMs).toISOString()
    const nextSubscription: PRSubscription = {
      ...subscription,
      updatedAt: now,
      lastCheckedAt: now,
      lastState: result.snapshot,
      consecutiveFailures: 0,
      backoffUntil: undefined,
      lastError: undefined,
      ...(result.changes.length > 0
        ? {
            lastEventAt: now,
            lastEventSummary: result.changes.map(change => change.message).join('; '),
          }
        : {}),
    }
    await upsertPRSubscription(nextSubscription)

    if (result.changes.length === 0) {
      onDone(undefined, { display: 'skip' })
      return
    }

    const message = result.changes.map(change => change.message).join('\n')
    context.addNotification?.({
      key: `subscribe-pr:${subscription.id}`,
      text: message,
      priority: 'high',
    })
    await maybeSendPushNotification(message)
    onDone(message, { display: 'system' })
  } catch (error) {
    const failures = (subscription.consecutiveFailures ?? 0) + 1
    const now = new Date(nowMs).toISOString()

    if (error instanceof GitHubRateLimitError) {
      const backoffUntil = new Date(
        nowMs + Math.max(error.retryAfterMs, 30_000 * 2 ** (failures - 1)),
      ).toISOString()
      await upsertPRSubscription({
        ...subscription,
        updatedAt: now,
        consecutiveFailures: failures,
        lastCheckedAt: now,
        backoffUntil,
        lastError: error.message,
        lastEventAt: now,
        lastEventSummary: `Rate limited until ${backoffUntil}`,
      })
      const message = `PR watcher for ${subscription.url} hit a GitHub rate limit. Backing off until ${backoffUntil}.`
      context.addNotification?.({
        key: `subscribe-pr-rate-limit:${subscription.id}`,
        text: message,
        priority: 'high',
      })
      onDone(message, { display: 'system' })
      return
    }

    await upsertPRSubscription({
      ...subscription,
      updatedAt: now,
      consecutiveFailures: failures,
      lastCheckedAt: now,
      lastError: error instanceof Error ? error.message : String(error),
    })
    onDone(undefined, { display: 'skip' })
  }
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<undefined> {
  const trimmed = args.trim()
  if (!trimmed) {
    onDone(HELP_TEXT, { display: 'system' })
    return
  }

  if (trimmed === 'list') {
    await handleList(onDone)
    return
  }

  if (trimmed.startsWith('remove ')) {
    await handleRemove(onDone, trimmed.slice('remove '.length).trim())
    return
  }

  if (trimmed.startsWith('poll ')) {
    await handlePoll(onDone, context, trimmed.slice('poll '.length).trim())
    return
  }

  try {
    const result = await subscribeToPullRequest({ url: trimmed })
    const action = result.created ? 'Watching' : 'Updated watch for'
    onDone(
      `${action} ${result.subscription.url} every ${result.subscription.intervalSec}s. Changes: ${result.subscription.events.join(', ')}.`,
      { display: 'system' },
    )
  } catch (error) {
    onDone(error instanceof Error ? error.message : String(error), {
      display: 'system',
    })
  }
}

const subscribePr = {
  type: 'local-jsx',
  name: 'subscribe-pr',
  description: 'Watch a GitHub pull request and notify on new activity',
  argumentHint: '<url>|list|remove <url>',
  load: () => Promise.resolve({ call }),
} satisfies Command

export default subscribePr
