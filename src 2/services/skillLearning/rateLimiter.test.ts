import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  archiveOldAppliedPatches,
  checkSkillRateLimit,
} from './rateLimiter.js'

const TEMP_DIRS: string[] = []
const ORIGINAL_CCD = process.env.CLAUDE_CONFIG_DIR

afterEach(() => {
  for (const d of TEMP_DIRS.splice(0)) rmSync(d, { recursive: true, force: true })
  if (ORIGINAL_CCD === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CCD
})

function setupConfigDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'kairos-sl-rl-'))
  TEMP_DIRS.push(d)
  process.env.CLAUDE_CONFIG_DIR = d
  const base = join(d, 'skills', '.pending-improvements')
  mkdirSync(join(base, 'applied'), { recursive: true })
  mkdirSync(join(base, 'rejected'), { recursive: true })
  return d
}

function writePending(
  configDir: string,
  id: string,
  skill: string,
  createdAt: number,
): void {
  const path = join(
    configDir,
    'skills',
    '.pending-improvements',
    `${id}.json`,
  )
  writeFileSync(
    path,
    JSON.stringify({
      id,
      createdAt,
      patch: {
        skill,
        edits: [{ type: 'add_note', content: 'x' }],
      },
    }),
  )
}

function writeApplied(
  configDir: string,
  id: string,
  skill: string,
  createdAt: number,
): void {
  const path = join(
    configDir,
    'skills',
    '.pending-improvements',
    'applied',
    `${id}.json`,
  )
  writeFileSync(
    path,
    JSON.stringify({
      id,
      createdAt,
      patch: {
        skill,
        edits: [{ type: 'add_note', content: 'x' }],
      },
    }),
  )
}

describe('checkSkillRateLimit', () => {
  test('allows first distillation', async () => {
    setupConfigDir()
    const now = 1_700_000_000_000
    const res = await checkSkillRateLimit('investigate', now, 24 * 3600_000)
    expect(res.ok).toBe(true)
  })

  test('blocks second distillation within window', async () => {
    const dir = setupConfigDir()
    const t0 = 1_700_000_000_000
    writePending(dir, 'p1', 'investigate', t0)
    const res = await checkSkillRateLimit('investigate', t0 + 60_000, 24 * 3600_000)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.nextAllowedAt).toBe(t0 + 24 * 3600_000)
  })

  test('allows distillation after window', async () => {
    const dir = setupConfigDir()
    const t0 = 1_700_000_000_000
    writePending(dir, 'p1', 'investigate', t0)
    const res = await checkSkillRateLimit(
      'investigate',
      t0 + 24 * 3600_000 + 1,
      24 * 3600_000,
    )
    expect(res.ok).toBe(true)
  })

  test('applied patches count toward the limit', async () => {
    const dir = setupConfigDir()
    const t0 = 1_700_000_000_000
    writeApplied(dir, 'a1', 'investigate', t0)
    const res = await checkSkillRateLimit('investigate', t0 + 60_000, 24 * 3600_000)
    expect(res.ok).toBe(false)
  })

  test('different skills are independent', async () => {
    const dir = setupConfigDir()
    const t0 = 1_700_000_000_000
    writePending(dir, 'p1', 'investigate', t0)
    const res = await checkSkillRateLimit('debug', t0 + 60_000, 24 * 3600_000)
    expect(res.ok).toBe(true)
  })
})

describe('archiveOldAppliedPatches', () => {
  test('moves old applied patches to archive/ and leaves recent ones', async () => {
    const dir = setupConfigDir()
    const t0 = 1_700_000_000_000
    const dayMs = 24 * 3600_000
    writeApplied(dir, 'old-1', 'investigate', t0)
    writeApplied(dir, 'old-2', 'debug', t0 + 1)
    writeApplied(dir, 'recent', 'investigate', t0 + 10 * dayMs)

    // Cutoff: anything strictly older than t0 + 5 days moves.
    const moved = await archiveOldAppliedPatches(t0 + 5 * dayMs)
    expect(moved).toBe(2)

    const appliedDir = join(dir, 'skills', '.pending-improvements', 'applied')
    const archiveDir = join(dir, 'skills', '.pending-improvements', 'archive')
    expect(readdirSync(appliedDir).sort()).toEqual(['recent.json'])
    expect(readdirSync(archiveDir).sort()).toEqual(['old-1.json', 'old-2.json'])
  })

  test('archived patches no longer affect rate limit', async () => {
    const dir = setupConfigDir()
    const t0 = 1_700_000_000_000
    const dayMs = 24 * 3600_000
    writeApplied(dir, 'ancient', 'investigate', t0)
    // Before archiving: within a very long window, the ancient patch blocks.
    const before = await checkSkillRateLimit('investigate', t0 + dayMs, 30 * dayMs)
    expect(before.ok).toBe(false)

    await archiveOldAppliedPatches(t0 + dayMs)
    // After archiving: the applied file is gone from applied/, so rate-limit
    // no longer sees it.
    const after = await checkSkillRateLimit('investigate', t0 + dayMs, 30 * dayMs)
    expect(after.ok).toBe(true)
  })

  test('no-op when applied/ is empty', async () => {
    setupConfigDir()
    const moved = await archiveOldAppliedPatches(Date.now())
    expect(moved).toBe(0)
  })

  test('does not create archive/ dir when nothing to move', async () => {
    const dir = setupConfigDir()
    const t0 = 1_700_000_000_000
    writeApplied(dir, 'recent', 'investigate', t0 + 100)
    await archiveOldAppliedPatches(t0)
    const archiveDir = join(dir, 'skills', '.pending-improvements', 'archive')
    expect(existsSync(archiveDir)).toBe(false)
  })
})
