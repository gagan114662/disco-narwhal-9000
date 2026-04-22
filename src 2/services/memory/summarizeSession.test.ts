import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { getPendingProposalDir, getSessionSummaryPath } from './paths.js'
import { summarizeAndIndexSessions, summarizeSessionAsync } from './summarizeSession.js'

const TEMP_DIRS: string[] = []

function makeConfigDir(settings: unknown = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-summary-test-'))
  TEMP_DIRS.push(dir)
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings))
  return dir
}

function writeTranscript(configDir: string, projectName: string, sessionId: string): void {
  const projectDir = join(configDir, 'projects', projectName)
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, `${sessionId}.jsonl`), [
    JSON.stringify({
      type: 'user',
      message: { content: 'We need to design session memory indexing for KAIROS.' },
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content:
          "We decided to use SQLite FTS5 for recall. Next step: document the score floor and pending proposal review flow.",
      },
    }),
    '',
  ].join('\n'))
}

beforeEach(() => {
  process.env.CLAUDE_CONFIG_DIR = makeConfigDir()
  resetSettingsCache()
})

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  resetSettingsCache()
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('summarizeSession', () => {
  test('produces a structured summary from a transcript', async () => {
    const configDir = process.env.CLAUDE_CONFIG_DIR as string
    writeTranscript(configDir, 'demo-project', 'sess-1')

    const summary = await summarizeSessionAsync('sess-1')

    expect(summary.session_id).toBe('sess-1')
    expect(summary.project).toBe('demo-project')
    expect(summary.one_liner).toContain('session memory indexing')
    expect(summary.decisions[0]).toContain('SQLite FTS5')
    expect(summary.open_loops[0]).toContain('score floor')
  })

  test('writes summary files idempotently and queues proposals when curation is enabled', async () => {
    const configDir = makeConfigDir({
      kairos: {
        memory: {
          curation: { enabled: true },
        },
      },
    })
    process.env.CLAUDE_CONFIG_DIR = configDir
    resetSettingsCache()
    writeTranscript(configDir, 'demo-project', 'sess-2')

    const first = await summarizeAndIndexSessions(['sess-2'])
    const second = await summarizeAndIndexSessions(['sess-2'])

    expect(first[0]?.changed).toBe(true)
    expect(second[0]?.changed).toBe(false)
    expect(first[0]?.proposals).toBeGreaterThan(0)

    const summaryPath = getSessionSummaryPath('sess-2')
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
      session_id: string
    }
    expect(summary.session_id).toBe('sess-2')

    expect(readdirSync(getPendingProposalDir()).length).toBeGreaterThan(0)
  })
})
