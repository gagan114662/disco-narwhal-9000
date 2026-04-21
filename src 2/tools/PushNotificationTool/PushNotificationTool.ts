import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  type PushNotificationPriority,
  sendPushNotification,
} from './transport.js'
import {
  DESCRIPTION,
  PUSH_NOTIFICATION_TOOL_NAME,
  PUSH_NOTIFICATION_TOOL_PROMPT,
} from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    title: z.string().describe('Short notification title shown to the user'),
    body: z.string().describe('Notification body text'),
    priority: z
      .enum(['low', 'normal', 'high'])
      .optional()
      .describe('Optional delivery priority. Defaults to normal.'),
    tag: z
      .string()
      .optional()
      .describe('Optional emoji or short tag shown with the notification'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    provider: z.enum(['ntfy', 'pushover']).optional(),
    target: z.string().optional(),
    title: z.string(),
    body: z.string(),
    priority: z.enum(['low', 'normal', 'high']),
    tag: z.string().optional(),
    deliveredAt: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function formatUseMessage(input: {
  title?: string
  priority?: PushNotificationPriority
}): string {
  const title = input.title ? ` "${input.title}"` : ''
  const priority =
    input.priority && input.priority !== 'normal'
      ? ` (${input.priority} priority)`
      : ''
  return `Sending push notification${title}${priority}`
}

export const PushNotificationTool = buildTool({
  name: PUSH_NOTIFICATION_TOOL_NAME,
  searchHint: 'send a real push notification to the user',
  maxResultSizeChars: 20_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PUSH_NOTIFICATION_TOOL_PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  toAutoClassifierInput(input) {
    return `${input.title}\n${input.body}`
  },
  renderToolUseMessage(input) {
    return formatUseMessage(input)
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (!output.success) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: output.error || 'Push notification failed.',
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Push notification sent via ${output.provider} to ${output.target}.`,
    }
  },
  async call({ title, body, priority = 'normal', tag }) {
    try {
      const delivery = await sendPushNotification({
        title,
        body,
        priority,
        tag,
      })
      return {
        data: {
          success: true,
          provider: delivery.provider,
          target: delivery.target,
          title,
          body,
          priority,
          tag,
          deliveredAt: new Date().toISOString(),
        },
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Push notification failed.'
      return {
        data: {
          success: false,
          title,
          body,
          priority,
          tag,
          error: message,
        },
      }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
