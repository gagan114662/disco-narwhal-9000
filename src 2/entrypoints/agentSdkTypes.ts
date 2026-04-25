/**
 * Main entrypoint for Claude Code Agent SDK types.
 *
 * This file re-exports the public SDK API from:
 * - sdk/coreTypes.ts - Common serializable types (messages, configs)
 * - sdk/runtimeTypes.ts - Non-serializable types (callbacks, interfaces)
 *
 * SDK builders who need control protocol types should import from
 * sdk/controlTypes.ts directly.
 */

import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomUUID } from 'crypto'
import { appendFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import {
  listSessionsImpl,
  parseSessionInfoFromLite,
  type SessionInfo,
} from '../utils/listSessionsImpl.js'
import {
  readSessionLite,
  readTranscriptForLoad,
  resolveSessionFilePath,
} from '../utils/sessionStoragePortable.js'
import { cronToHuman } from '../utils/cron.js'
import { parseJSONL } from '../utils/json.js'

// Control protocol types for SDK builders (bridge subpath consumers)
/** @alpha */
export type {
  SDKControlRequest,
  SDKControlResponse,
} from './sdk/controlTypes.js'
// Re-export core types (common serializable types)
export * from './sdk/coreTypes.js'
// Re-export runtime types (callbacks, interfaces with methods)
export * from './sdk/runtimeTypes.js'

// Re-export settings types (generated from settings JSON schema)
export type { Settings } from './sdk/settingsTypes.generated.js'
// Re-export tool types (all marked @internal until SDK API stabilizes)
export * from './sdk/toolTypes.js'

// ============================================================================
// Functions
// ============================================================================

import type {
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from './sdk/coreTypes.js'
// Import types needed for function signatures
import type {
  AnyZodRawShape,
  InferShape,
  McpSdkServerConfigWithInstance,
  Options,
  Query,
  SDKSession,
  SDKSessionOptions,
  SdkMcpToolDefinition,
} from './sdk/runtimeTypes.js'

type InternalOptions = Options
type InternalQuery = Query

export type SDKSessionInfo = SessionInfo

export type ListSessionsOptions = {
  dir?: string
  limit?: number
  offset?: number
  includeWorktrees?: boolean
}

export type GetSessionInfoOptions = {
  dir?: string
}

export type GetSessionMessagesOptions = {
  dir?: string
  limit?: number
  offset?: number
  includeSystemMessages?: boolean
}

export type SessionMutationOptions = {
  dir?: string
}

export type ForkSessionOptions = {
  dir?: string
  upToMessageId?: string
  title?: string
}

export type ForkSessionResult = {
  sessionId: string
}

export type SessionMessage = {
  type: string
  uuid: string
  parentUuid: string | null
  logicalParentUuid?: string | null
  sessionId?: string
  timestamp?: string
  isSidechain?: boolean
  message?: unknown
  [key: string]: unknown
}

type ContentReplacementEntry = {
  type: 'content-replacement'
  sessionId: string
  replacements: unknown[]
}

function unsupportedSdkApi(name: string): never {
  throw new Error(
    `${name} is not available in this rebuilt CLI distribution yet. The KAIROS CLI and daemon are supported; the public Agent SDK compatibility layer is partial.`,
  )
}

function sessionDir(options: unknown): string | undefined {
  return (options as { dir?: string } | undefined)?.dir
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSessionMessage(entry: unknown): entry is SessionMessage {
  if (!isRecord(entry)) return false
  if (typeof entry.type !== 'string') return false
  if (typeof entry.uuid !== 'string') return false
  return entry.parentUuid === null || typeof entry.parentUuid === 'string'
}

function isConversationMessage(
  entry: SessionMessage,
  includeSystemMessages: boolean,
): boolean {
  return (
    entry.type === 'user' ||
    entry.type === 'assistant' ||
    entry.type === 'attachment' ||
    (includeSystemMessages && entry.type === 'system')
  )
}

function parseTranscriptMessages(buf: Buffer): Map<string, SessionMessage> {
  const messages = new Map<string, SessionMessage>()
  const progressBridge = new Map<string, string | null>()

  for (const entry of parseJSONL<unknown>(buf)) {
    if (
      isRecord(entry) &&
      entry.type === 'progress' &&
      typeof entry.uuid === 'string'
    ) {
      const parentUuid =
        entry.parentUuid === null || typeof entry.parentUuid === 'string'
          ? (entry.parentUuid as string | null)
          : null
      const uuid = entry.uuid
      progressBridge.set(
        uuid,
        parentUuid && progressBridge.has(parentUuid)
          ? (progressBridge.get(parentUuid) ?? null)
          : parentUuid,
      )
      continue
    }

    if (!isSessionMessage(entry)) continue
    if (
      !['user', 'assistant', 'attachment', 'system'].includes(entry.type) ||
      entry.isSidechain === true
    ) {
      continue
    }

    if (entry.parentUuid && progressBridge.has(entry.parentUuid)) {
      entry.parentUuid = progressBridge.get(entry.parentUuid) ?? null
    }
    messages.set(entry.uuid, entry)
  }

  return messages
}

function findLatestLeaf(
  messages: Iterable<SessionMessage>,
): SessionMessage | undefined {
  const all = [...messages]
  const parentUuids = new Set(
    all
      .map(message => message.parentUuid)
      .filter((uuid): uuid is string => typeof uuid === 'string'),
  )

  let latest: SessionMessage | undefined
  let maxTime = -Infinity
  for (let index = 0; index < all.length; index++) {
    const message = all[index]!
    if (parentUuids.has(message.uuid)) continue
    const timestamp =
      typeof message.timestamp === 'string'
        ? Date.parse(message.timestamp)
        : NaN
    const time = Number.isFinite(timestamp) ? timestamp : index
    if (time > maxTime) {
      maxTime = time
      latest = message
    }
  }
  return latest
}

function buildSessionChain(
  messages: Map<string, SessionMessage>,
  leaf: SessionMessage,
): SessionMessage[] {
  const chain: SessionMessage[] = []
  const seen = new Set<string>()
  let current: SessionMessage | undefined = leaf

  while (current && !seen.has(current.uuid)) {
    seen.add(current.uuid)
    chain.push(current)
    current = current.parentUuid ? messages.get(current.parentUuid) : undefined
  }

  chain.reverse()
  return chain
}

function contentReplacementRecordsFor(
  buf: Buffer,
  sessionId: string,
): unknown[] {
  return parseJSONL<unknown>(buf).flatMap(entry => {
    if (!isRecord(entry)) return []
    if (entry.type !== 'content-replacement') return []
    if (entry.sessionId !== sessionId) return []
    if (!Array.isArray(entry.replacements)) return []
    return (entry as ContentReplacementEntry).replacements
  })
}

function cloneForkMessage(
  entry: SessionMessage,
  sourceSessionId: string,
  forkSessionId: string,
  uuidMap: Map<string, string>,
): SessionMessage {
  const originalUuid = entry.uuid
  const forkedUuid = uuidMap.get(originalUuid)
  if (!forkedUuid) {
    throw new Error(
      `Unable to fork message without UUID mapping: ${originalUuid}`,
    )
  }

  return {
    ...entry,
    uuid: forkedUuid,
    parentUuid: entry.parentUuid
      ? (uuidMap.get(entry.parentUuid) ?? null)
      : null,
    logicalParentUuid: entry.logicalParentUuid
      ? (uuidMap.get(entry.logicalParentUuid) ?? null)
      : entry.logicalParentUuid,
    sessionId: forkSessionId,
    isSidechain: false,
    forkedFrom: {
      sessionId: sourceSessionId,
      messageUuid: originalUuid,
    },
  }
}

function findForkBoundary(
  chain: SessionMessage[],
  upToMessageId: string | undefined,
): number {
  if (!upToMessageId) return chain.length
  const index = chain.findIndex(message => message.uuid === upToMessageId)
  if (index === -1) {
    throw new Error(`Message not found in session chain: ${upToMessageId}`)
  }
  return index + 1
}

async function resolveMutableSessionFile(
  sessionId: string,
  options: unknown,
): Promise<string> {
  const resolved = await resolveSessionFilePath(sessionId, sessionDir(options))
  if (!resolved) {
    throw new Error(`Session not found: ${sessionId}`)
  }
  return resolved.filePath
}

export function tool<Schema extends AnyZodRawShape>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (
    args: InferShape<Schema>,
    extra: unknown,
  ) => Promise<CallToolResult>,
  extras?: {
    annotations?: ToolAnnotations
    searchHint?: string
    alwaysLoad?: boolean
  },
): SdkMcpToolDefinition<Schema> {
  const definition = {
    name,
    description,
    inputSchema,
    handler,
  } satisfies SdkMcpToolDefinition<Schema>
  return extras
    ? ({ ...definition, ...extras } as SdkMcpToolDefinition<Schema>)
    : definition
}

type CreateSdkMcpServerOptions = {
  name: string
  version?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: Array<SdkMcpToolDefinition<any>>
}

/**
 * Creates an MCP server instance that can be used with the SDK transport.
 * This allows SDK users to define custom tools that run in the same process.
 *
 * If your SDK MCP calls will run longer than 60s, override CLAUDE_CODE_STREAM_CLOSE_TIMEOUT
 */
export function createSdkMcpServer(
  options: CreateSdkMcpServerOptions,
): McpSdkServerConfigWithInstance {
  const server = new McpServer(
    {
      name: options.name,
      version: options.version ?? '1.0.0',
    },
    {
      capabilities: {
        tools: options.tools ? {} : undefined,
      },
    },
  )
  for (const toolDef of options.tools ?? []) {
    server.tool(
      toolDef.name,
      toolDef.description,
      toolDef.inputSchema,
      toolDef.handler,
    )
  }
  return {
    type: 'sdk',
    name: options.name,
    instance: server,
  } as McpSdkServerConfigWithInstance
}

export class AbortError extends Error {}

/** @internal */
export function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: InternalOptions
}): InternalQuery
export function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}): Query
export function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: InternalOptions | Options
}): Query {
  unsupportedSdkApi('query')
}

/**
 * V2 API - UNSTABLE
 * Create a persistent session for multi-turn conversations.
 * @alpha
 */
export function unstable_v2_createSession(
  options: SDKSessionOptions,
): SDKSession {
  unsupportedSdkApi('unstable_v2_createSession')
}

/**
 * V2 API - UNSTABLE
 * Resume an existing session by ID.
 * @alpha
 */
export function unstable_v2_resumeSession(
  sessionId: string,
  options: SDKSessionOptions,
): SDKSession {
  unsupportedSdkApi('unstable_v2_resumeSession')
}

// @[MODEL LAUNCH]: Update the example model ID in this docstring.
/**
 * V2 API - UNSTABLE
 * One-shot convenience function for single prompts.
 * @alpha
 *
 * @example
 * ```typescript
 * const result = await unstable_v2_prompt("What files are here?", {
 *   model: 'claude-sonnet-4-6'
 * })
 * ```
 */
export async function unstable_v2_prompt(
  message: string,
  options: SDKSessionOptions,
): Promise<SDKResultMessage> {
  unsupportedSdkApi('unstable_v2_prompt')
}

/**
 * Reads a session's conversation messages from its JSONL transcript file.
 *
 * Parses the transcript, builds the conversation chain via parentUuid links,
 * and returns user/assistant messages in chronological order. Set
 * `includeSystemMessages: true` in options to also include system messages.
 *
 * @param sessionId - UUID of the session to read
 * @param options - Optional dir, limit, offset, and includeSystemMessages
 * @returns Array of messages, or empty array if session not found
 */
export async function getSessionMessages(
  sessionId: string,
  options?: GetSessionMessagesOptions,
): Promise<SessionMessage[]> {
  const resolved = await resolveSessionFilePath(sessionId, sessionDir(options))
  if (!resolved) return []

  const { postBoundaryBuf } = await readTranscriptForLoad(
    resolved.filePath,
    resolved.fileSize,
  )
  const messages = parseTranscriptMessages(postBoundaryBuf)
  const leaf = findLatestLeaf(messages.values())
  if (!leaf) return []

  const includeSystemMessages = options?.includeSystemMessages === true
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = options?.limit ?? 0
  const chain = buildSessionChain(messages, leaf).filter(message =>
    isConversationMessage(message, includeSystemMessages),
  )
  const page = chain.slice(offset)
  return limit > 0 ? page.slice(0, limit) : page
}

/**
 * List sessions with metadata.
 *
 * When `dir` is provided, returns sessions for that project directory
 * and its git worktrees. When omitted, returns sessions across all
 * projects.
 *
 * Use `limit` and `offset` for pagination.
 *
 * @example
 * ```typescript
 * // List sessions for a specific project
 * const sessions = await listSessions({ dir: '/path/to/project' })
 *
 * // Paginate
 * const page1 = await listSessions({ limit: 50 })
 * const page2 = await listSessions({ limit: 50, offset: 50 })
 * ```
 */
export async function listSessions(
  options?: ListSessionsOptions,
): Promise<SDKSessionInfo[]> {
  return (await listSessionsImpl(options)) as SDKSessionInfo[]
}

/**
 * Reads metadata for a single session by ID. Unlike `listSessions`, this only
 * reads the single session file rather than every session in the project.
 * Returns undefined if the session file is not found, is a sidechain session,
 * or has no extractable summary.
 *
 * @param sessionId - UUID of the session
 * @param options - `{ dir?: string }` project path; omit to search all project directories
 */
export async function getSessionInfo(
  sessionId: string,
  options?: GetSessionInfoOptions,
): Promise<SDKSessionInfo | undefined> {
  const resolved = await resolveSessionFilePath(sessionId, sessionDir(options))
  if (!resolved) return undefined
  const lite = await readSessionLite(resolved.filePath)
  if (!lite) return undefined
  return (
    parseSessionInfoFromLite(sessionId, lite, resolved.projectPath) ?? undefined
  ) as SDKSessionInfo | undefined
}

/**
 * Rename a session. Appends a custom-title entry to the session's JSONL file.
 * @param sessionId - UUID of the session
 * @param title - New title
 * @param options - `{ dir?: string }` project path; omit to search all projects
 */
export async function renameSession(
  sessionId: string,
  title: string,
  options?: SessionMutationOptions,
): Promise<void> {
  if (title.trim().length === 0) {
    throw new Error('Session title cannot be empty')
  }
  const filePath = await resolveMutableSessionFile(sessionId, options)
  await appendFile(
    filePath,
    JSON.stringify({ type: 'custom-title', customTitle: title, sessionId }) +
      '\n',
    'utf8',
  )
}

/**
 * Tag a session. Pass null to clear the tag.
 * @param sessionId - UUID of the session
 * @param tag - Tag string, or null to clear
 * @param options - `{ dir?: string }` project path; omit to search all projects
 */
export async function tagSession(
  sessionId: string,
  tag: string | null,
  options?: SessionMutationOptions,
): Promise<void> {
  const filePath = await resolveMutableSessionFile(sessionId, options)
  await appendFile(
    filePath,
    JSON.stringify({ type: 'tag', tag: tag ?? '', sessionId }) + '\n',
    'utf8',
  )
}

/**
 * Fork a session into a new branch with fresh UUIDs.
 *
 * Copies transcript messages from the source session into a new session file,
 * remapping every message UUID and preserving the parentUuid chain. Supports
 * `upToMessageId` for branching from a specific point in the conversation.
 *
 * Forked sessions start without undo history (file-history snapshots are not
 * copied).
 *
 * @param sessionId - UUID of the source session
 * @param options - `{ dir?, upToMessageId?, title? }`
 * @returns `{ sessionId }` — UUID of the new forked session
 */
export async function forkSession(
  sessionId: string,
  options?: ForkSessionOptions,
): Promise<ForkSessionResult> {
  if (options?.title !== undefined && options.title.trim().length === 0) {
    throw new Error('Session title cannot be empty')
  }

  const resolved = await resolveSessionFilePath(sessionId, sessionDir(options))
  if (!resolved) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  const { postBoundaryBuf } = await readTranscriptForLoad(
    resolved.filePath,
    resolved.fileSize,
  )
  const messages = parseTranscriptMessages(postBoundaryBuf)
  const leaf = findLatestLeaf(messages.values())
  if (!leaf) {
    throw new Error(`No messages to fork: ${sessionId}`)
  }

  const sourceChain = buildSessionChain(messages, leaf)
  const forkBoundary = findForkBoundary(sourceChain, options?.upToMessageId)
  const forkSource = sourceChain.slice(0, forkBoundary)
  if (forkSource.length === 0) {
    throw new Error(`No messages to fork: ${sessionId}`)
  }

  const forkSessionId = randomUUID()
  const uuidMap = new Map(
    forkSource.map(message => [message.uuid, randomUUID()] as const),
  )
  const forkedMessages = forkSource.map(message =>
    cloneForkMessage(message, sessionId, forkSessionId, uuidMap),
  )
  const lines = forkedMessages.map(message => JSON.stringify(message))

  if (options?.title) {
    lines.push(
      JSON.stringify({
        type: 'custom-title',
        customTitle: options.title.trim(),
        sessionId: forkSessionId,
      }),
    )
  }

  const replacements = contentReplacementRecordsFor(postBoundaryBuf, sessionId)
  if (replacements.length > 0) {
    lines.push(
      JSON.stringify({
        type: 'content-replacement',
        sessionId: forkSessionId,
        replacements,
      }),
    )
  }

  const forkPath = join(dirname(resolved.filePath), `${forkSessionId}.jsonl`)
  await writeFile(forkPath, lines.join('\n') + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })

  return { sessionId: forkSessionId }
}

// ============================================================================
// Assistant daemon primitives (internal)
// ============================================================================

/**
 * A scheduled task from `<dir>/.claude/scheduled_tasks.json`.
 * @internal
 */
export type CronTask = {
  id: string
  cron: string
  prompt: string
  createdAt: number
  recurring?: boolean
}

/**
 * Cron scheduler tuning knobs (jitter + expiry). Sourced at runtime from the
 * `tengu_kairos_cron_config` GrowthBook config in CLI sessions; daemon hosts
 * pass this through `watchScheduledTasks({ getJitterConfig })` to get the
 * same tuning.
 * @internal
 */
export type CronJitterConfig = {
  recurringFrac: number
  recurringCapMs: number
  oneShotMaxMs: number
  oneShotFloorMs: number
  oneShotMinuteMod: number
  recurringMaxAgeMs: number
}

/**
 * Event yielded by `watchScheduledTasks()`.
 * @internal
 */
export type ScheduledTaskEvent =
  | { type: 'fire'; task: CronTask }
  | { type: 'missed'; tasks: CronTask[] }

/**
 * Handle returned by `watchScheduledTasks()`.
 * @internal
 */
export type ScheduledTasksHandle = {
  /** Async stream of fire/missed events. Drain with `for await`. */
  events(): AsyncGenerator<ScheduledTaskEvent>
  /**
   * Epoch ms of the soonest scheduled fire across all loaded tasks, or null
   * if nothing is scheduled. Useful for deciding whether to tear down an
   * idle agent subprocess or keep it warm for an imminent fire.
   */
  getNextFireTime(): number | null
}

/**
 * Watch `<dir>/.claude/scheduled_tasks.json` and yield events as tasks fire.
 *
 * Acquires the per-directory scheduler lock (PID-based liveness) so a REPL
 * session in the same dir won't double-fire. Releases the lock and closes
 * the file watcher when the signal aborts.
 *
 * - `fire` — a task whose cron schedule was met. One-shot tasks are already
 *   deleted from the file when this yields; recurring tasks are rescheduled
 *   (or deleted if aged out).
 * - `missed` — one-shot tasks whose window passed while the daemon was down.
 *   Yielded once on initial load; a background delete removes them from the
 *   file shortly after.
 *
 * Intended for daemon architectures that own the scheduler externally and
 * spawn the agent via `query()`; the agent subprocess (`-p` mode) does not
 * run its own scheduler.
 *
 * @internal
 */
export function watchScheduledTasks(_opts: {
  dir: string
  signal: AbortSignal
  getJitterConfig?: () => CronJitterConfig
}): ScheduledTasksHandle {
  unsupportedSdkApi('watchScheduledTasks')
}

/**
 * Format missed one-shot tasks into a prompt that asks the model to confirm
 * with the user (via AskUserQuestion) before executing.
 * @internal
 */
export function buildMissedTaskNotification(_missed: CronTask[]): string {
  const plural = _missed.length > 1
  const header =
    `The following one-shot scheduled task${plural ? 's were' : ' was'} missed while Claude was not running. ` +
    `${plural ? 'They have' : 'It has'} already been removed from .claude/scheduled_tasks.json.\n\n` +
    `Do NOT execute ${plural ? 'these prompts' : 'this prompt'} yet. ` +
    `First use the AskUserQuestion tool to ask whether to run ${plural ? 'each one' : 'it'} now. ` +
    `Only execute if the user confirms.`

  const blocks = _missed.map(t => {
    const meta = `[${cronToHuman(t.cron)}, created ${new Date(t.createdAt).toLocaleString()}]`
    const backtickRuns = t.prompt.match(/`+/g) ?? []
    let longestRun = 0
    for (const run of backtickRuns) {
      longestRun = Math.max(longestRun, run.length)
    }
    const fence = '`'.repeat(Math.max(3, longestRun + 1))
    return `${meta}\n${fence}\n${t.prompt}\n${fence}`
  })

  return `${header}\n\n${blocks.join('\n\n')}`
}

/**
 * A user message typed on claude.ai, extracted from the bridge WS.
 * @internal
 */
export type InboundPrompt = {
  content: string | unknown[]
  uuid?: string
}

/**
 * Options for connectRemoteControl.
 * @internal
 */
export type ConnectRemoteControlOptions = {
  dir: string
  name?: string
  workerType?: string
  branch?: string
  gitRepoUrl?: string | null
  getAccessToken: () => string | undefined
  baseUrl: string
  orgUUID: string
  model: string
}

/**
 * Handle returned by connectRemoteControl. Write query() yields in,
 * read inbound prompts out. See src/assistant/daemonBridge.ts for full
 * field documentation.
 * @internal
 */
export type RemoteControlHandle = {
  sessionUrl: string
  environmentId: string
  bridgeSessionId: string
  write(msg: SDKMessage): void
  sendResult(): void
  sendControlRequest(req: unknown): void
  sendControlResponse(res: unknown): void
  sendControlCancelRequest(requestId: string): void
  inboundPrompts(): AsyncGenerator<InboundPrompt>
  controlRequests(): AsyncGenerator<unknown>
  permissionResponses(): AsyncGenerator<unknown>
  onStateChange(
    cb: (
      state: 'ready' | 'connected' | 'reconnecting' | 'failed',
      detail?: string,
    ) => void,
  ): void
  teardown(): Promise<void>
}

/**
 * Hold a claude.ai remote-control bridge connection from a daemon process.
 *
 * The daemon owns the WebSocket in the PARENT process — if the agent
 * subprocess (spawned via `query()`) crashes, the daemon respawns it while
 * claude.ai keeps the same session. Contrast with `query.enableRemoteControl`
 * which puts the WS in the CHILD process (dies with the agent).
 *
 * Pipe `query()` yields through `write()` + `sendResult()`. Read
 * `inboundPrompts()` (user typed on claude.ai) into `query()`'s input
 * stream. Handle `controlRequests()` locally (interrupt → abort, set_model
 * → reconfigure).
 *
 * Skips the `tengu_ccr_bridge` gate and policy-limits check — @internal
 * caller is pre-entitled. OAuth is still required (env var or keychain).
 *
 * Returns null on no-OAuth or registration failure.
 *
 * @internal
 */
export async function connectRemoteControl(
  _opts: ConnectRemoteControlOptions,
): Promise<RemoteControlHandle | null> {
  unsupportedSdkApi('connectRemoteControl')
}
