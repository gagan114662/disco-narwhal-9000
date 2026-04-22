import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { MemoryProposalInput, SessionSummary } from './curationProposer.js'
import { deriveMemoryProposalsFromSummary } from './curationProposer.js'
import { isKairosMemoryCurationEnabled } from './config.js'
import { queueMemoryProposal } from './proposalQueue.js'
import {
  getSessionSummaryPath,
  ensureKairosMemoryDirs,
} from './paths.js'
import { upsertSessionSummary } from './sessionIndex.js'
import { resolveSessionFilePath } from '../../utils/sessionStoragePortable.js'

type TranscriptEntry = {
  type?: string
  timestamp?: string
  uuid?: string
  message?: {
    content?: unknown
  }
}

type ExtractedTranscript = {
  sessionId: string
  project: string
  when: string
  turns: Array<{ role: 'user' | 'assistant'; text: string }>
}

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'because',
  'before',
  'being',
  'between',
  'build',
  'change',
  'changes',
  'claude',
  'code',
  'current',
  'file',
  'files',
  'from',
  'have',
  'into',
  'issue',
  'just',
  'last',
  'more',
  'next',
  'only',
  'past',
  'project',
  'session',
  'should',
  'some',
  'than',
  'that',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'tool',
  'used',
  'user',
  'using',
  'with',
  'work',
  'would',
])

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncate(value: string, max = 140): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).trimEnd()}…`
}

function parseContent(content: unknown): string {
  if (typeof content === 'string') {
    return compactWhitespace(content)
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return compactWhitespace(
    content
      .flatMap(block => {
        if (
          typeof block === 'object' &&
          block !== null &&
          'type' in block &&
          'text' in block &&
          (block as { type?: unknown }).type === 'text' &&
          typeof (block as { text?: unknown }).text === 'string'
        ) {
          return [(block as { text: string }).text]
        }
        return []
      })
      .join(' '),
  )
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(compactWhitespace)
    .filter(Boolean)
}

function collectTopics(turns: ExtractedTranscript['turns']): string[] {
  const frequencies = new Map<string, number>()
  for (const turn of turns) {
    for (const token of turn.text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      if (token.length < 4 || STOP_WORDS.has(token)) continue
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
    }
  }
  return [...frequencies.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([token]) => token)
}

function collectByPattern(
  turns: ExtractedTranscript['turns'],
  pattern: RegExp,
  limit: number,
): string[] {
  const seen = new Set<string>()
  const collected: string[] = []
  for (const turn of turns) {
    for (const sentence of splitSentences(turn.text)) {
      if (!pattern.test(sentence)) continue
      const normalized = truncate(sentence, 220)
      const key = normalized.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      collected.push(normalized)
      if (collected.length >= limit) {
        return collected
      }
    }
  }
  return collected
}

function summarizeExtractedTranscript(
  extracted: ExtractedTranscript,
): SessionSummary {
  const assistantTurns = extracted.turns.filter(
    turn => turn.role === 'assistant',
  )
  const firstUserTurn =
    extracted.turns.find(turn => turn.role === 'user' && turn.text.length > 0)
      ?.text ?? 'Session summary unavailable.'

  const decisionsFromAssistant = collectByPattern(
    assistantTurns,
    /\b(decide|decision|agreed|we will|we'll|use\b|ship|plan is|settled on)\b/i,
    5,
  )
  const decisions =
    decisionsFromAssistant.length > 0
      ? decisionsFromAssistant
      : collectByPattern(
          extracted.turns,
          /\b(decide|decision|agreed|we will|we'll|use\b|ship|plan is|settled on)\b/i,
          5,
        )
  const openLoopsFromAssistant = collectByPattern(
    assistantTurns,
    /\b(todo|follow up|next step|next up|need to|pending|remaining|open question|still need)\b/i,
    5,
  )
  const openLoops =
    openLoopsFromAssistant.length > 0
      ? openLoopsFromAssistant
      : collectByPattern(
          extracted.turns,
          /\b(todo|follow up|next step|next up|need to|pending|remaining|open question|still need)\b/i,
          5,
        )

  return {
    session_id: extracted.sessionId,
    project: extracted.project,
    when: extracted.when,
    one_liner: truncate(firstUserTurn, 120),
    topics: collectTopics(extracted.turns),
    decisions,
    open_loops: openLoops,
  }
}

function loadTranscriptEntries(raw: string): TranscriptEntry[] {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line) as TranscriptEntry]
      } catch {
        return []
      }
    })
}

function extractTranscript(
  sessionId: string,
  filePath: string,
  projectPath: string | undefined,
): ExtractedTranscript {
  const raw = readFileSync(filePath, 'utf8')
  const stat = statSync(filePath)
  const entries = loadTranscriptEntries(raw)
  const turns = entries
    .flatMap(entry => {
      if (entry.type !== 'user' && entry.type !== 'assistant') {
        return []
      }
      const text = parseContent(entry.message?.content)
      if (!text) return []
      return [
        {
          role: entry.type,
          text,
        } as const,
      ]
    })

  return {
    sessionId,
    project:
      projectPath?.split('/').filter(Boolean).at(-1) ??
      basename(dirname(filePath)),
    when: stat.mtime.toISOString(),
    turns,
  }
}

export function buildSessionSummaryPrompt(args: {
  sessionId: string
  transcriptPath: string
  summaryPath: string
}): string {
  return [
    'You are running a KAIROS session-memory indexing task.',
    `Session: ${args.sessionId}`,
    `Transcript: ${args.transcriptPath}`,
    `Output summary: ${args.summaryPath}`,
    '',
    'Use Bash once to run the local summarizer service, then stop:',
    `bun -e "import { summarizeAndIndexSessions } from './services/memory/summarizeSession.js'; const result = await summarizeAndIndexSessions(['${args.sessionId}']); console.log(JSON.stringify(result, null, 2));"`,
  ].join('\n')
}

export async function summarizeSessionAsync(
  sessionId: string,
  opts: { dir?: string } = {},
): Promise<SessionSummary> {
  const resolved = await resolveSessionFilePath(sessionId, opts.dir)
  if (!resolved) {
    throw new Error(`Unable to locate transcript for session ${sessionId}.`)
  }
  const extracted = extractTranscript(
    sessionId,
    resolved.filePath,
    resolved.projectPath,
  )
  return summarizeExtractedTranscript(extracted)
}

function writeSummaryFile(summary: SessionSummary): {
  path: string
  changed: boolean
} {
  ensureKairosMemoryDirs()
  mkdirSync(dirname(getSessionSummaryPath(summary.session_id)), {
    recursive: true,
    mode: 0o700,
  })
  const path = getSessionSummaryPath(summary.session_id)
  const next = `${JSON.stringify(summary, null, 2)}\n`
  const previous = (() => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  })()
  if (previous === next) {
    return { path, changed: false }
  }
  writeFileSync(path, next, { encoding: 'utf8', mode: 0o600 })
  return { path, changed: true }
}

function maybeQueueProposals(summary: SessionSummary): MemoryProposalInput[] {
  if (!isKairosMemoryCurationEnabled()) {
    return []
  }
  const proposals = deriveMemoryProposalsFromSummary(summary)
  for (const proposal of proposals) {
    queueMemoryProposal(proposal)
  }
  return proposals
}

export async function summarizeAndIndexSessions(
  sessionIds: string[],
  opts: { dir?: string } = {},
): Promise<
  Array<{
    sessionId: string
    summaryPath: string
    changed: boolean
    proposals: number
  }>
> {
  const results: Array<{
    sessionId: string
    summaryPath: string
    changed: boolean
    proposals: number
  }> = []

  for (const sessionId of sessionIds) {
    const summary = await summarizeSessionAsync(sessionId, opts)
    const { path, changed } = writeSummaryFile(summary)
    upsertSessionSummary(summary)
    const proposals = changed ? maybeQueueProposals(summary) : []
    results.push({
      sessionId,
      summaryPath: path,
      changed,
      proposals: proposals.length,
    })
  }

  return results
}
