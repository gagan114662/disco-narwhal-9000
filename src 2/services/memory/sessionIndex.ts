import { Database } from 'bun:sqlite'
import { chmodSync, closeSync, existsSync, openSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { ensureKairosMemoryDirs, getSessionIndexPath } from './paths.js'
import {
  getKairosMemoryRetentionDays,
  getKairosMemoryScoreFloor,
  isKairosMemoryIndexEnabled,
} from './config.js'
import type { SessionSummary } from './curationProposer.js'

export type SessionPinState = 'default' | 'pinned' | 'excluded'

export type RecallMatch = {
  session_id: string
  one_liner: string
  relevant_decisions: string[]
  score: number
}

type SearchRow = {
  session_id: string
  project: string
  when_iso: string
  one_liner: string
  topics_json: string
  decisions_json: string
  open_loops_json: string
}

const SEARCH_LIMIT_MULTIPLIER = 5

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
        token => token.length >= 2,
      ),
    ),
  )
}

function joinSearchable(values: string[]): string {
  return values.join(' ').trim()
}

function buildMatchQuery(query: string): string {
  const tokens = tokenize(query)
  if (tokens.length === 0) {
    return '""'
  }
  return tokens.map(token => `"${token}"`).join(' OR ')
}

function scoreSummary(query: string, summary: SessionSummary): number {
  const tokens = tokenize(query)
  if (tokens.length === 0) return 0

  let score = 0
  for (const token of tokens) {
    if (summary.one_liner.toLowerCase().includes(token)) score += 4
    if (summary.project.toLowerCase().includes(token)) score += 2
    if (summary.topics.some(topic => topic.toLowerCase().includes(token)))
      score += 3
    if (
      summary.decisions.some(decision => decision.toLowerCase().includes(token))
    ) {
      score += 3
    }
    if (
      summary.open_loops.some(loop => loop.toLowerCase().includes(token))
    ) {
      score += 2
    }
  }

  const max = tokens.length * 14
  return max === 0 ? 0 : Number((score / max).toFixed(3))
}

function pickRelevantDecisions(
  query: string,
  summary: SessionSummary,
): string[] {
  const tokens = tokenize(query)
  const matching = summary.decisions.filter(decision =>
    tokens.some(token => decision.toLowerCase().includes(token)),
  )
  if (matching.length > 0) {
    return matching.slice(0, 3)
  }
  return summary.decisions.slice(0, 2)
}

function createSummaryFromRow(row: SearchRow): SessionSummary {
  return {
    session_id: row.session_id,
    project: row.project,
    when: row.when_iso,
    one_liner: row.one_liner,
    topics: JSON.parse(row.topics_json) as string[],
    decisions: JSON.parse(row.decisions_json) as string[],
    open_loops: JSON.parse(row.open_loops_json) as string[],
  }
}

function ensureIndexFile(): string {
  ensureKairosMemoryDirs()
  const dbPath = getSessionIndexPath()
  if (!existsSync(dbPath)) {
    const fd = openSync(dbPath, 'a', 0o600)
    closeSync(fd)
  }
  chmodSync(dbPath, 0o600)
  return dbPath
}

function openSessionIndex(): Database {
  const dbPath = ensureIndexFile()
  const db = new Database(dbPath, { create: true, strict: true })
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS session_summaries (
      session_id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      when_iso TEXT NOT NULL,
      one_liner TEXT NOT NULL,
      topics_json TEXT NOT NULL,
      decisions_json TEXT NOT NULL,
      open_loops_json TEXT NOT NULL,
      pin_state TEXT NOT NULL DEFAULT 'default'
        CHECK (pin_state IN ('default', 'pinned', 'excluded'))
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS session_search USING fts5(
      session_id UNINDEXED,
      project,
      one_liner,
      topics,
      decisions,
      open_loops
    );
  `)
  return db
}

export function upsertSessionSummary(summary: SessionSummary): void {
  if (!isKairosMemoryIndexEnabled()) return
  const db = openSessionIndex()
  try {
    db.transaction(() => {
      db.prepare(
        `
          INSERT INTO session_summaries (
            session_id, project, when_iso, one_liner, topics_json, decisions_json, open_loops_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            project = excluded.project,
            when_iso = excluded.when_iso,
            one_liner = excluded.one_liner,
            topics_json = excluded.topics_json,
            decisions_json = excluded.decisions_json,
            open_loops_json = excluded.open_loops_json
        `,
      ).run(
        summary.session_id,
        summary.project,
        summary.when,
        summary.one_liner,
        JSON.stringify(summary.topics),
        JSON.stringify(summary.decisions),
        JSON.stringify(summary.open_loops),
      )

      db.prepare(`DELETE FROM session_search WHERE session_id = ?`).run(
        summary.session_id,
      )
      db.prepare(
        `
          INSERT INTO session_search (
            session_id, project, one_liner, topics, decisions, open_loops
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      ).run(
        summary.session_id,
        summary.project,
        summary.one_liner,
        joinSearchable(summary.topics),
        joinSearchable(summary.decisions),
        joinSearchable(summary.open_loops),
      )
    })()
  } finally {
    db.close()
  }
}

export function searchSessionSummaries(args: {
  query: string
  project?: string
  since?: string
  top_k?: number
  scoreFloor?: number
}): { matches: RecallMatch[] } {
  if (!isKairosMemoryIndexEnabled()) {
    return { matches: [] }
  }

  const db = openSessionIndex()
  try {
    const topK = Math.max(1, Math.min(args.top_k ?? 5, 25))
    const matchQuery = buildMatchQuery(args.query)
    if (matchQuery === '""') {
      return { matches: [] }
    }
    const rows = db
      .query<SearchRow, [string, string | null, string | null, string | null, string | null]>(
        `
          SELECT
            s.session_id,
            s.project,
            s.when_iso,
            s.one_liner,
            s.topics_json,
            s.decisions_json,
            s.open_loops_json
          FROM session_search f
          JOIN session_summaries s ON s.session_id = f.session_id
          WHERE session_search MATCH ?
            AND s.pin_state != 'excluded'
            AND (? IS NULL OR s.project = ?)
            AND (? IS NULL OR s.when_iso >= ?)
          LIMIT ${topK * SEARCH_LIMIT_MULTIPLIER}
        `,
      )
      .all(
        matchQuery,
        args.project ?? null,
        args.project ?? null,
        args.since ?? null,
        args.since ?? null,
      )

    const floor = args.scoreFloor ?? getKairosMemoryScoreFloor()
    const matches = rows
      .map(row => {
        const summary = createSummaryFromRow(row)
        const score = scoreSummary(args.query, summary)
        return {
          session_id: summary.session_id,
          one_liner: summary.one_liner,
          relevant_decisions: pickRelevantDecisions(args.query, summary),
          score,
        } satisfies RecallMatch
      })
      .filter(match => match.score >= floor)
      .sort((left, right) => right.score - left.score)
      .slice(0, topK)

    return { matches }
  } finally {
    db.close()
  }
}

export function setSessionPinState(
  sessionId: string,
  pinState: SessionPinState,
): void {
  const db = openSessionIndex()
  try {
    db.prepare(
      `UPDATE session_summaries SET pin_state = ? WHERE session_id = ?`,
    ).run(pinState, sessionId)
  } finally {
    db.close()
  }
}

export function pruneExpiredSessionSummaries(now = new Date()): number {
  const db = openSessionIndex()
  const cutoff = new Date(now)
  cutoff.setUTCDate(cutoff.getUTCDate() - getKairosMemoryRetentionDays())
  const cutoffIso = cutoff.toISOString()
  try {
    const deleted = db
      .prepare(
        `
          DELETE FROM session_summaries
          WHERE pin_state != 'pinned'
            AND when_iso < ?
        `,
      )
      .run(cutoffIso)
    db.prepare(
      `
        DELETE FROM session_search
        WHERE session_id NOT IN (
          SELECT session_id FROM session_summaries
        )
      `,
    ).run()
    return Number(deleted.changes)
  } finally {
    db.close()
  }
}

export function getIndexedSessionCount(): number {
  const db = openSessionIndex()
  try {
    const row = db
      .query<{ count: number }, []>(
        `SELECT COUNT(*) AS count FROM session_summaries`,
      )
      .get()
    return row?.count ?? 0
  } finally {
    db.close()
  }
}

export function wipeSessionIndex(): void {
  rmSync(getSessionIndexPath(), { force: true })
}
