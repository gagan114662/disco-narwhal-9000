import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applySkillPatch, SkillPatchApplyError } from './applyPatch.js'
import {
  getAppliedPatchPath,
  getPendingPatchPath,
  getRejectedPatchPath,
  getSkillFilePath,
} from './paths.js'
import type { SkillPatch } from './patchSchema.js'
import {
  listPendingPatches,
  loadPatchById,
  movePatchTo,
  renderPatchDiff,
} from './reviewQueue.js'

const TEMP_DIRS: string[] = []
const ORIGINAL_CCD = process.env.CLAUDE_CONFIG_DIR

afterEach(() => {
  for (const d of TEMP_DIRS.splice(0)) rmSync(d, { recursive: true, force: true })
  if (ORIGINAL_CCD === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CCD
})

function setup(): string {
  const d = mkdtempSync(join(tmpdir(), 'kairos-sl-rq-'))
  TEMP_DIRS.push(d)
  process.env.CLAUDE_CONFIG_DIR = d
  mkdirSync(join(d, 'skills', '.pending-improvements', 'applied'), {
    recursive: true,
  })
  mkdirSync(join(d, 'skills', '.pending-improvements', 'rejected'), {
    recursive: true,
  })
  mkdirSync(join(d, 'skills', '.pending-improvements', 'backups'), {
    recursive: true,
  })
  return d
}

function writePending(id: string, patch: SkillPatch, createdAt = 1_700_000_000_000): void {
  writeFileSync(
    getPendingPatchPath(id),
    JSON.stringify({ id, createdAt, patch }, null, 2),
  )
}

const SAMPLE_PATCH: SkillPatch = {
  skill: 'investigate',
  edits: [{ type: 'add_note', content: 'remember to check env files' }],
}

describe('reviewQueue', () => {
  test('list returns pending patches newest-first', async () => {
    setup()
    writePending('a', SAMPLE_PATCH, 1000)
    writePending('b', SAMPLE_PATCH, 2000)
    const patches = await listPendingPatches()
    expect(patches.map(p => p.id)).toEqual(['b', 'a'])
  })

  test('loadPatchById finds pending', async () => {
    setup()
    writePending('x', SAMPLE_PATCH)
    const p = await loadPatchById('x')
    expect(p?.status).toBe('pending')
  })

  test('loadPatchById returns null for unknown id', async () => {
    setup()
    const p = await loadPatchById('missing')
    expect(p).toBeNull()
  })

  test('movePatchTo(rejected) moves the file', async () => {
    setup()
    writePending('c', SAMPLE_PATCH)
    await movePatchTo('c', 'rejected')
    expect(existsSync(getPendingPatchPath('c'))).toBe(false)
    expect(existsSync(getRejectedPatchPath('c'))).toBe(true)
  })

  test('renderPatchDiff includes edit headers and additive lines', () => {
    const out = renderPatchDiff({
      skill: 'x',
      edits: [
        { type: 'add_note', content: 'hello\nworld' },
        { type: 'add_example', content: 'ex' },
      ],
      summary: 's',
    })
    expect(out).toContain('# Skill: x')
    expect(out).toContain('# Summary: s')
    expect(out).toContain('## Edit 1: add_note')
    expect(out).toContain('+ hello')
    expect(out).toContain('## Edit 2: add_example')
  })
})

describe('applySkillPatch', () => {
  function writeSkillFile(name: string, body: string): string {
    const p = getSkillFilePath(name)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, body, 'utf-8')
    return p
  }

  test('applies additive patch and writes a backup', async () => {
    setup()
    const skillPath = writeSkillFile('investigate', '# Investigate\n\nstep 1\n')
    const result = await applySkillPatch(SAMPLE_PATCH)
    const written = readFileSync(skillPath, 'utf-8')
    expect(written).toContain('step 1')
    expect(written).toContain('remember to check env files')
    expect(existsSync(result.backupPath)).toBe(true)
    const backup = readFileSync(result.backupPath, 'utf-8')
    expect(backup).toBe('# Investigate\n\nstep 1\n')
  })

  test('refine_step with anchor inserts after the matching line', async () => {
    setup()
    const skillPath = writeSkillFile(
      'investigate',
      '# Investigate\n\nstep one\nstep two\nstep three\n',
    )
    await applySkillPatch({
      skill: 'investigate',
      edits: [
        {
          type: 'refine_step',
          content: 'after step two, also verify env',
          anchor: 'step two',
        },
      ],
    })
    const body = readFileSync(skillPath, 'utf-8')
    const idxTwo = body.indexOf('step two')
    const idxInjected = body.indexOf('after step two')
    const idxThree = body.indexOf('step three')
    expect(idxTwo).toBeLessThan(idxInjected)
    expect(idxInjected).toBeLessThan(idxThree)
  })

  test('throws if live skill file is missing', async () => {
    setup()
    await expect(applySkillPatch(SAMPLE_PATCH)).rejects.toBeInstanceOf(
      SkillPatchApplyError,
    )
  })
})
