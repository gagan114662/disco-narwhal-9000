import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import {
  getIndexedSessionCount,
  pruneExpiredSessionSummaries,
  searchSessionSummaries,
  setSessionPinState,
  upsertSessionSummary,
  wipeSessionIndex,
} from './sessionIndex.js'

const TEMP_DIRS: string[] = []

function makeConfigDir(settings: unknown = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-memory-index-'))
  TEMP_DIRS.push(dir)
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings))
  return dir
}

beforeEach(() => {
  process.env.CLAUDE_CONFIG_DIR = makeConfigDir()
  resetSettingsCache()
})

afterEach(() => {
  wipeSessionIndex()
  delete process.env.CLAUDE_CONFIG_DIR
  resetSettingsCache()
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('sessionIndex', () => {
  test('upsert is idempotent and FTS query returns the matching session', () => {
    upsertSessionSummary({
      session_id: 'sess-auth',
      project: 'brasilia',
      when: '2026-04-20T00:00:00.000Z',
      one_liner: 'Decided how auth refresh should work.',
      topics: ['auth', 'refresh', 'tokens'],
      decisions: ['We decided to use refresh tokens for daemon auth.'],
      open_loops: ['Need to document auth expiry handling.'],
    })
    upsertSessionSummary({
      session_id: 'sess-auth',
      project: 'brasilia',
      when: '2026-04-20T00:00:00.000Z',
      one_liner: 'Decided how auth refresh should work.',
      topics: ['auth', 'refresh', 'tokens'],
      decisions: ['We decided to use refresh tokens for daemon auth.'],
      open_loops: ['Need to document auth expiry handling.'],
    })
    upsertSessionSummary({
      session_id: 'sess-ui',
      project: 'atlas',
      when: '2026-04-21T00:00:00.000Z',
      one_liner: 'Reviewed dashboard styling.',
      topics: ['dashboard', 'styling'],
      decisions: ['We will keep the current dashboard layout.'],
      open_loops: [],
    })

    expect(getIndexedSessionCount()).toBe(2)

    const result = searchSessionSummaries({
      query: 'what did we decide about daemon auth refresh',
      top_k: 3,
    })

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({
      session_id: 'sess-auth',
    })
  })

  test('score floor prevents unrelated matches', () => {
    upsertSessionSummary({
      session_id: 'sess-db',
      project: 'brasilia',
      when: '2026-04-20T00:00:00.000Z',
      one_liner: 'Indexed FTS5 session summaries.',
      topics: ['fts5', 'sqlite', 'memory'],
      decisions: ['We chose SQLite FTS5 for recall search.'],
      open_loops: [],
    })

    const result = searchSessionSummaries({
      query: 'gardening plans',
      top_k: 3,
      scoreFloor: 0.2,
    })

    expect(result.matches).toEqual([])
  })

  test('excluded sessions never appear and pinned sessions survive pruning', () => {
    upsertSessionSummary({
      session_id: 'old-pinned',
      project: 'brasilia',
      when: '2025-12-01T00:00:00.000Z',
      one_liner: 'Pinned planning session.',
      topics: ['planning'],
      decisions: ['We will keep this historical plan pinned.'],
      open_loops: [],
    })
    upsertSessionSummary({
      session_id: 'old-default',
      project: 'brasilia',
      when: '2025-12-01T00:00:00.000Z',
      one_liner: 'Old transient session.',
      topics: ['transient'],
      decisions: ['We tested a short-lived migration path.'],
      open_loops: [],
    })
    upsertSessionSummary({
      session_id: 'excluded-session',
      project: 'brasilia',
      when: '2026-04-20T00:00:00.000Z',
      one_liner: 'Private session.',
      topics: ['private'],
      decisions: ['We discussed something excluded.'],
      open_loops: [],
    })

    setSessionPinState('old-pinned', 'pinned')
    setSessionPinState('excluded-session', 'excluded')

    const deleted = pruneExpiredSessionSummaries(
      new Date('2026-04-22T00:00:00.000Z'),
    )
    expect(deleted).toBe(1)

    const result = searchSessionSummaries({
      query: 'private excluded discussed',
      top_k: 5,
      scoreFloor: 0,
    })
    expect(result.matches).toEqual([])

    const pinnedResult = searchSessionSummaries({
      query: 'historical plan pinned',
      top_k: 5,
      scoreFloor: 0,
    })
    expect(pinnedResult.matches[0]?.session_id).toBe('old-pinned')
  })
})
