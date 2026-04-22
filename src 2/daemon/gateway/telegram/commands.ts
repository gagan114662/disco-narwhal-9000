// Inbound command dispatcher.
//
// Parses the first whitespace-separated token of a DMed message. If it's
// an allowlisted slash-command we dispatch, otherwise we return a "help"
// reply so the user discovers what's available. Everything here is pure
// functions + injected dependencies so the long-poll loop just wires
// inputs through and does no policy decisions of its own.

import { getKairosPausePath, getKairosStatusPath } from '../../kairos/paths.js'
import { createReminderFromUserRequest } from '../../../services/reminders/createReminderFromUserRequest.js'
import type { CreateReminderResult } from '../../../services/reminders/createReminderFromUserRequest.js'

export type CommandName =
  | 'status'
  | 'pause'
  | 'resume'
  | 'remind'
  | 'skip'
  | 'help'
  | 'unknown'

const COMMAND_HELP = [
  '/status — show daemon + pause state',
  '/pause — pause KAIROS',
  '/resume — resume KAIROS',
  '/remind <when> <what> — e.g. `/remind 2m drink water`',
  '/skip — dismiss the last surfaced message',
].join('\n')

export type ParsedCommand = {
  name: CommandName
  rest: string
  raw: string
}

export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) {
    return { name: 'unknown', rest: trimmed, raw: trimmed }
  }
  const match = trimmed.match(/^\/([A-Za-z_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/)
  if (!match) {
    return { name: 'unknown', rest: '', raw: trimmed }
  }
  const head = match[1].toLowerCase()
  const rest = (match[2] ?? '').trim()
  switch (head) {
    case 'status':
      return { name: 'status', rest, raw: trimmed }
    case 'pause':
      return { name: 'pause', rest, raw: trimmed }
    case 'resume':
      return { name: 'resume', rest, raw: trimmed }
    case 'remind':
      return { name: 'remind', rest, raw: trimmed }
    case 'skip':
      return { name: 'skip', rest, raw: trimmed }
    case 'help':
    case 'start':
      return { name: 'help', rest, raw: trimmed }
    default:
      return { name: 'unknown', rest, raw: trimmed }
  }
}

const DURATION_REGEX = /^(\d+)\s*(s|sec|secs|seconds|m|min|mins|minutes|h|hr|hrs|hours|d|day|days)$/i

/**
 * Parse the "when" token of /remind. Accepts durations like `2m`, `1h`,
 * `90s`, `1 day` (relative to `now`) and absolute ISO 8601 timestamps.
 * Returns null on anything ambiguous — callers surface a clear error so
 * we don't guess and schedule the wrong minute.
 */
export function parseReminderWhen(token: string, now: Date): Date | null {
  const normalized = token.trim()
  if (!normalized) return null

  const durationMatch = normalized.match(DURATION_REGEX)
  if (durationMatch) {
    const n = Number(durationMatch[1])
    const unit = durationMatch[2].toLowerCase()
    let ms = 0
    if (unit.startsWith('s')) ms = n * 1000
    else if (unit.startsWith('min') || unit === 'm') ms = n * 60 * 1000
    else if (unit.startsWith('h')) ms = n * 60 * 60 * 1000
    else if (unit.startsWith('d')) ms = n * 24 * 60 * 60 * 1000
    if (ms <= 0) return null
    return new Date(now.getTime() + ms)
  }

  // Absolute timestamp path — require something that looks like ISO 8601
  // to avoid swallowing free-form English (which `new Date()` parses
  // inconsistently across locales).
  if (/^\d{4}-\d{2}-\d{2}/.test(normalized)) {
    const parsed = new Date(normalized)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return null
}

export type StatusSummary = {
  daemonState: string
  pid?: number
  paused: boolean
  pauseReason?: string
  projectCount: number
}

export type DispatchDeps = {
  now?: () => Date
  readStatus: () => Promise<unknown>
  readPause: () => Promise<unknown>
  listProjects: () => Promise<string[]>
  setPause: (paused: boolean) => Promise<void>
  scheduleReminder: typeof createReminderFromUserRequest
  recordSkip: (params: { chatId: number; now: Date }) => Promise<void>
}

export type DispatchInput = {
  chatId: number
  text: string
}

export type DispatchResult = {
  reply: string
}

function formatStatus(
  status: unknown,
  pause: unknown,
  projectCount: number,
): string {
  const lines: string[] = []
  const s = status as Record<string, unknown> | null
  if (s && typeof s.state === 'string') {
    lines.push(`daemon: ${s.state}${s.pid ? ` (pid ${String(s.pid)})` : ''}`)
  } else {
    lines.push('daemon: not running')
  }
  const p = pause as Record<string, unknown> | null
  if (p?.paused === true) {
    const reason = typeof p.reason === 'string' ? ` [${p.reason}]` : ''
    lines.push(`paused: yes${reason}`)
  } else {
    lines.push('paused: no')
  }
  lines.push(`projects: ${projectCount}`)
  return lines.join('\n')
}

export function createDispatcher(deps: DispatchDeps) {
  const now = deps.now ?? (() => new Date())

  async function handleRemind(rest: string): Promise<string> {
    if (!rest) return 'Usage: /remind <when> <what>  e.g. /remind 2m drink water'
    const [whenToken, ...remaining] = rest.split(/\s+/)
    const textRaw = remaining.join(' ').trim()
    if (!textRaw) {
      return 'Usage: /remind <when> <what>  e.g. /remind 2m drink water'
    }
    const at = parseReminderWhen(whenToken, now())
    if (!at) {
      return `Can't schedule reminder: couldn't parse "${whenToken}". Try \`2m\`, \`1h\`, or an ISO timestamp.`
    }
    const projects = await deps.listProjects()
    if (projects.length === 0) {
      return "Can't schedule reminder: no KAIROS projects opted in. Run `/kairos opt-in` first."
    }
    const projectDir = projects[0]
    const result: CreateReminderResult = await deps.scheduleReminder(
      { projectDir, text: textRaw, at },
      { now: now() },
    )
    return result.message
  }

  async function dispatch(input: DispatchInput): Promise<DispatchResult> {
    const parsed = parseCommand(input.text)
    switch (parsed.name) {
      case 'status': {
        const [status, pause, projects] = await Promise.all([
          deps.readStatus(),
          deps.readPause(),
          deps.listProjects(),
        ])
        return { reply: formatStatus(status, pause, projects.length) }
      }
      case 'pause':
        await deps.setPause(true)
        return { reply: 'Paused KAIROS. Fired tasks skipped until /resume.' }
      case 'resume':
        await deps.setPause(false)
        return { reply: 'Resumed KAIROS.' }
      case 'remind':
        return { reply: await handleRemind(parsed.rest) }
      case 'skip':
        await deps.recordSkip({ chatId: input.chatId, now: now() })
        return { reply: 'Noted. Last surfaced message dismissed.' }
      case 'help':
        return { reply: `KAIROS commands:\n${COMMAND_HELP}` }
      case 'unknown':
        return {
          reply: `Unknown command. Try /help.\n\n${COMMAND_HELP}`,
        }
    }
  }

  return { dispatch }
}

export function getKairosPausePathExport(): string {
  return getKairosPausePath()
}

export function getKairosStatusPathExport(): string {
  return getKairosStatusPath()
}
