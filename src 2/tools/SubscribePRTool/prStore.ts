import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { logForDebugging } from '../../utils/debug.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { safeParseJSON } from '../../utils/json.js'
import { jsonStringify } from '../../utils/slowOperations.js'

export const SUBSCRIBE_PR_EVENTS = [
  'commit',
  'comment',
  'check',
  'state',
] as const

export type SubscribePREvent = (typeof SUBSCRIBE_PR_EVENTS)[number]

export type PRCheckSummary = 'none' | 'pending' | 'passed' | 'failed'
export type PRLifecycleState = 'open' | 'closed' | 'merged'

export type PRCommentSnapshot = {
  id: number
  author: string
  body: string
  url: string
  createdAt: string
}

export type PRSnapshot = {
  state: PRLifecycleState
  headSha: string
  commentCount: number
  checkSummary: PRCheckSummary
  latestComment?: PRCommentSnapshot
}

export type PRSubscription = {
  id: string
  url: string
  owner: string
  repo: string
  number: number
  intervalSec: number
  events: SubscribePREvent[]
  cron: string
  cronTaskId: string
  createdAt: string
  updatedAt: string
  lastCheckedAt?: string
  lastState?: PRSnapshot
  lastEventAt?: string
  lastEventSummary?: string
  consecutiveFailures?: number
  backoffUntil?: string
  lastError?: string
}

type SubscriptionFile = {
  subscriptions: PRSubscription[]
}

export function getPRSubscriptionStorePath(): string {
  return join(getClaudeConfigHomeDir(), 'subscriptions.json')
}

export function createSubscriptionId(): string {
  return randomUUID().slice(0, 8)
}

export function normalizeSubscriptionEvents(
  events?: readonly SubscribePREvent[],
): SubscribePREvent[] {
  if (!events || events.length === 0) {
    return [...SUBSCRIBE_PR_EVENTS]
  }
  return SUBSCRIBE_PR_EVENTS.filter(event => events.includes(event))
}

export async function readPRSubscriptions(): Promise<PRSubscription[]> {
  try {
    const raw = await readFile(getPRSubscriptionStorePath(), 'utf8')
    const parsed = safeParseJSON(raw, false) as SubscriptionFile | null
    if (!parsed || !Array.isArray(parsed.subscriptions)) {
      return []
    }
    return parsed.subscriptions.filter(
      subscription =>
        subscription &&
        typeof subscription.id === 'string' &&
        typeof subscription.url === 'string' &&
        typeof subscription.owner === 'string' &&
        typeof subscription.repo === 'string' &&
        typeof subscription.number === 'number' &&
        typeof subscription.intervalSec === 'number' &&
        Array.isArray(subscription.events) &&
        typeof subscription.cron === 'string' &&
        typeof subscription.cronTaskId === 'string' &&
        typeof subscription.createdAt === 'string' &&
        typeof subscription.updatedAt === 'string',
    )
  } catch (error) {
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return []
    }
    logForDebugging(`[SubscribePR] failed to read store: ${String(error)}`)
    return []
  }
}

export async function writePRSubscriptions(
  subscriptions: PRSubscription[],
): Promise<void> {
  const path = getPRSubscriptionStorePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    jsonStringify({ subscriptions } satisfies SubscriptionFile, null, 2) + '\n',
    'utf8',
  )
}

export async function getPRSubscriptionByUrl(
  url: string,
): Promise<PRSubscription | null> {
  const subscriptions = await readPRSubscriptions()
  return subscriptions.find(subscription => subscription.url === url) ?? null
}

export async function upsertPRSubscription(
  nextSubscription: PRSubscription,
): Promise<void> {
  const subscriptions = await readPRSubscriptions()
  const next = subscriptions.filter(
    subscription => subscription.id !== nextSubscription.id,
  )
  next.push(nextSubscription)
  next.sort((a, b) => a.url.localeCompare(b.url))
  await writePRSubscriptions(next)
}

export async function deletePRSubscriptionById(id: string): Promise<void> {
  const subscriptions = await readPRSubscriptions()
  const next = subscriptions.filter(subscription => subscription.id !== id)
  if (next.length === subscriptions.length) {
    return
  }
  await writePRSubscriptions(next)
}
