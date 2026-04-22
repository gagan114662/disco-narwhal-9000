import { z } from 'zod/v4'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { searchSessionSummaries } from '../../services/memory/sessionIndex.js'
import { lazySchema } from '../../utils/lazySchema.js'

const TOOL_NAME = 'RecallPastSessions'

const inputSchema = lazySchema(() =>
  z.strictObject({
    query: z
      .string()
      .describe(
        'Natural-language description of the past work to recall, such as "what did we decide about auth last week?"',
      ),
    project: z
      .string()
      .optional()
      .describe('Optional project name filter.'),
    since: z
      .string()
      .optional()
      .describe('Optional ISO date filter, such as 2026-04-01T00:00:00.000Z.'),
    top_k: z
      .number()
      .int()
      .min(1)
      .max(25)
      .optional()
      .describe('Maximum number of matching sessions to return.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    matches: z.array(
      z.object({
        session_id: z.string(),
        one_liner: z.string(),
        relevant_decisions: z.array(z.string()),
        score: z.number(),
      }),
    ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function validateSinceDate(value: string | undefined): ValidationResult {
  if (!value) return { result: true }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return {
      result: false,
      message: '`since` must be an ISO date string.',
      errorCode: 1,
    }
  }
  return { result: true }
}

export const RecallPastSessionsTool = buildTool({
  name: TOOL_NAME,
  searchHint: 'search session-memory summaries from past sessions',
  maxResultSizeChars: 20_000,
  async description() {
    return (
      'Search indexed session summaries from prior KAIROS sessions. ' +
      'Use this when the user asks about previous decisions, plans, or unresolved work.'
    )
  },
  async prompt() {
    return (
      'Use this tool when the user references prior sessions, earlier plans, or ' +
      'past decisions. Pass a focused query, and optionally narrow by project ' +
      'or date when the user gives that context.'
    )
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
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return [input.query, input.project, input.since].filter(Boolean).join('\n')
  },
  async validateInput(input) {
    if (!input.query.trim()) {
      return {
        result: false,
        message: '`query` must be non-empty.',
        errorCode: 1,
      }
    }
    return validateSinceDate(input.since)
  },
  renderToolUseMessage(input) {
    return `Searching past sessions for "${input.query}"`
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const count = output.matches.length
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content:
        count === 0
          ? 'No relevant past sessions found.'
          : `Found ${count} past session${count === 1 ? '' : 's'}.`,
    }
  },
  async call({ query, project, since, top_k }) {
    return {
      data: searchSessionSummaries({
        query,
        project,
        since,
        top_k,
      }),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
