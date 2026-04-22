import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import {
  acceptMemoryProposal,
  listPendingMemoryProposals,
  queueMemoryProposal,
  rejectMemoryProposal,
  wipeAllKairosMemoryArtifacts,
} from './proposalQueue.js'
import { getArchivedProposalDir } from './paths.js'

const TEMP_DIRS: string[] = []

function makeConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-proposal-test-'))
  TEMP_DIRS.push(dir)
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({}))
  return dir
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

describe('proposalQueue', () => {
  test('accept writes to MEMORY.md with a backup', () => {
    const configDir = process.env.CLAUDE_CONFIG_DIR as string
    writeFileSync(join(configDir, 'MEMORY.md'), '- existing item\n')
    const proposal = queueMemoryProposal(
      {
        kind: 'fact',
        content: 'The system stores session recall in SQLite FTS5.',
        evidence_session_id: 'sess-a',
      },
      { generateId: () => 'accept01' },
    )

    const accepted = acceptMemoryProposal(proposal.id)

    expect(readFileSync(accepted.targetPath, 'utf8')).toContain(
      'SQLite FTS5',
    )
    expect(readFileSync(accepted.backupPath, 'utf8')).toContain('existing item')
    expect(listPendingMemoryProposals()).toEqual([])
  })

  test('reject archives the proposal without touching memory files', () => {
    const proposal = queueMemoryProposal(
      {
        kind: 'pattern',
        content: 'Always review the proposal queue before promoting memory.',
        evidence_session_id: 'sess-b',
      },
      { generateId: () => 'reject01' },
    )

    const rejected = rejectMemoryProposal(proposal.id)

    expect(rejected.id).toBe('reject01')
    expect(readdirSync(getArchivedProposalDir())).toContain('reject01.json')
  })

  test('wipe removes queued artifacts', () => {
    queueMemoryProposal(
      {
        kind: 'preference',
        content: 'The user prefers concise summaries.',
        evidence_session_id: 'sess-c',
      },
      { generateId: () => 'wipe01' },
    )

    wipeAllKairosMemoryArtifacts()

    expect(() => readdirSync(getArchivedProposalDir())).toThrow()
  })
})
