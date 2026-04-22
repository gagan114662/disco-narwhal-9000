import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import { setScheduledTasksEnabled } from '../../bootstrap/state.js'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { addCronTask, removeCronTasks } from '../../utils/cronTasks.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  createSubscriptionId,
  type PRSnapshot,
  type PRSubscription,
  type SubscribePREvent,
  getPRSubscriptionByUrl,
  normalizeSubscriptionEvents,
  upsertPRSubscription,
} from './prStore.js'
import { fetchPullRequestSnapshot, parsePullRequestUrl } from './poller.js'
import {
  DESCRIPTION,
  SUBSCRIBE_PR_TOOL_NAME,
  SUBSCRIBE_PR_TOOL_PROMPT,
} from './prompt.js'

const DEFAULT_INTERVAL_SEC = 60
const MIN_INTERVAL_SEC = 30
const MAX_INTERVAL_SEC = 3600
const CRON_EXPRESSION = '* * * * *'

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z
      .string()
      .describe(
        'Full GitHub PR URL like https://github.com/owner/repo/pull/123',
      ),
    intervalSec: z
      .number()
      .int()
      .min(MIN_INTERVAL_SEC)
      .max(MAX_INTERVAL_SEC)
      .optional()
      .describe('Polling interval in seconds. Defaults to 60.'),
    events: z
      .array(z.enum(['commit', 'comment', 'check', 'state']))
      .optional()
      .describe(
        'Optional event filter. Defaults to commit, comment, check, and state.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    created: z.boolean(),
    id: z.string(),
    url: z.string(),
    intervalSec: z.number(),
    events: z.array(z.enum(['commit', 'comment', 'check', 'state'])),
    cronTaskId: z.string(),
    state: z.enum(['open', 'closed', 'merged']),
    checkSummary: z.enum(['none', 'pending', 'passed', 'failed']),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type SubscribePRToolOutput = z.infer<OutputSchema>

export type SubscribeToPullRequestResult = {
  created: boolean
  subscription: PRSubscription
  initialSnapshot: PRSnapshot
}

export function buildSubscribePRCronPrompt(url: string): string {
  return `/subscribe-pr poll ${url}`
}

export async function subscribeToPullRequest(input: {
  url: string
  intervalSec?: number
  events?: readonly SubscribePREvent[]
}): Promise<SubscribeToPullRequestResult> {
  const parsed = parsePullRequestUrl(input.url)
  if (!parsed) {
    throw new Error(
      'Invalid GitHub PR URL. Expected https://github.com/owner/repo/pull/N',
    )
  }

  const now = new Date().toISOString()
  const intervalSec = input.intervalSec ?? DEFAULT_INTERVAL_SEC
  const events = normalizeSubscriptionEvents(input.events)
  const existing = await getPRSubscriptionByUrl(parsed.url)
  const initialSnapshot = await fetchPullRequestSnapshot(parsed)
  const cronTaskId = await addCronTask(
    CRON_EXPRESSION,
    buildSubscribePRCronPrompt(parsed.url),
    true,
    true,
  )

  if (existing?.cronTaskId) {
    await removeCronTasks([existing.cronTaskId])
  }

  setScheduledTasksEnabled(true)

  const subscription: PRSubscription = {
    id: existing?.id ?? createSubscriptionId(),
    url: parsed.url,
    owner: parsed.owner,
    repo: parsed.repo,
    number: parsed.number,
    intervalSec,
    events,
    cron: CRON_EXPRESSION,
    cronTaskId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastCheckedAt: now,
    lastState: initialSnapshot,
    consecutiveFailures: 0,
  }

  await upsertPRSubscription(subscription)

  return {
    created: existing == null,
    subscription,
    initialSnapshot,
  }
}

function formatUseMessage(input: { url?: string }): string {
  return input.url ? `Watching PR ${input.url}` : 'Watching a GitHub PR'
}

export const SubscribePRTool = buildTool({
  name: SUBSCRIBE_PR_TOOL_NAME,
  searchHint: 'watch a GitHub pull request for activity',
  maxResultSizeChars: 20_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return feature('KAIROS_GITHUB_WEBHOOKS')
  },
  isConcurrencySafe() {
    return true
  },
  toAutoClassifierInput(input) {
    return `${input.url}\n${input.intervalSec ?? DEFAULT_INTERVAL_SEC}`
  },
  async validateInput(input): Promise<ValidationResult> {
    if (!parsePullRequestUrl(input.url)) {
      return {
        result: false,
        message:
          'Invalid GitHub PR URL. Expected https://github.com/owner/repo/pull/N',
        errorCode: 1,
      }
    }
    return { result: true }
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return SUBSCRIBE_PR_TOOL_PROMPT
  },
  renderToolUseMessage(input) {
    return formatUseMessage(input)
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const action = output.created ? 'Watching' : 'Updated watch for'
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `${action} ${output.url} every ${output.intervalSec}s for ${output.events.join(', ')}.`,
    }
  },
  async call({ url, intervalSec = DEFAULT_INTERVAL_SEC, events }) {
    const result = await subscribeToPullRequest({ url, intervalSec, events })
    return {
      data: {
        created: result.created,
        id: result.subscription.id,
        url: result.subscription.url,
        intervalSec: result.subscription.intervalSec,
        events: result.subscription.events,
        cronTaskId: result.subscription.cronTaskId,
        state: result.initialSnapshot.state,
        checkSummary: result.initialSnapshot.checkSummary,
      },
    }
  },
} satisfies ToolDef<InputSchema, SubscribePRToolOutput>)
