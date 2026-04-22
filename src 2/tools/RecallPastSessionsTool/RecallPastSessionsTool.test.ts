import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { upsertSessionSummary, wipeSessionIndex } from '../../services/memory/sessionIndex.js'
import { RecallPastSessionsTool } from './RecallPastSessionsTool.js'

const TEMP_DIRS: string[] = []

function makeConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-recall-tool-'))
  TEMP_DIRS.push(dir)
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({}))
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

describe('RecallPastSessionsTool', () => {
  test('returns scored matches with relevant decisions', async () => {
    upsertSessionSummary({
      session_id: 'sess-1',
      project: 'brasilia',
      when: '2026-04-21T00:00:00.000Z',
      one_liner: 'Settled the session recall design.',
      topics: ['recall', 'fts5', 'memory'],
      decisions: ['We chose SQLite FTS5 for session recall.'],
      open_loops: ['Need to define the score floor.'],
    })

    const result = await RecallPastSessionsTool.call(
      {
        query: 'what did we decide about session recall',
        top_k: 5,
      },
      // @ts-expect-error test-only invocation without tool context
      undefined,
    )

    expect(result.data.matches).toHaveLength(1)
    expect(result.data.matches[0]?.session_id).toBe('sess-1')
    expect(result.data.matches[0]?.relevant_decisions[0]).toContain('FTS5')
    expect(result.data.matches[0]?.score).toBeGreaterThan(0)
  })

  test('validateInput rejects invalid since values', async () => {
    const result = await RecallPastSessionsTool.validateInput!(
      {
        query: 'past auth work',
        since: 'not-a-date',
      },
      // @ts-expect-error test-only invocation without tool context
      undefined,
    )

    expect(result.result).toBe(false)
  })
})
