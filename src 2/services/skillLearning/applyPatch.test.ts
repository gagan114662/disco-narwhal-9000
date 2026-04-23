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
import { getPendingPatchPath, getSkillFilePath } from './paths.js'
import type { SkillPatch } from './patchSchema.js'
import { recordPatchApproval, type SkillPatchApproval } from './reviewQueue.js'

const TEMP_DIRS: string[] = []
const ORIGINAL_CCD = process.env.CLAUDE_CONFIG_DIR

afterEach(() => {
  for (const d of TEMP_DIRS.splice(0)) rmSync(d, { recursive: true, force: true })
  if (ORIGINAL_CCD === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CCD
})

function setup(): string {
  const d = mkdtempSync(join(tmpdir(), 'kairos-sl-apply-'))
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

function writeSkillFile(name: string, body: string): string {
  const p = getSkillFilePath(name)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, body, 'utf-8')
  return p
}

const SAMPLE_PATCH: SkillPatch = {
  skill: 'investigate',
  edits: [{ type: 'add_note', content: 'remember to check env files' }],
}

function sampleApproval(approvalId = 'patch-1'): SkillPatchApproval {
  return {
    approvalId,
    approvedAt: 1_700_000_100_000,
    approvedBy: 'reviewer',
  }
}

describe('applySkillPatch', () => {
  test('called with no approval throws manual approval required', async () => {
    setup()
    writeSkillFile('investigate', '# Investigate\n\nstep 1\n')
    writePending('patch-1', SAMPLE_PATCH)
    await expect(
      applySkillPatch(SAMPLE_PATCH, undefined as never),
    ).rejects.toThrow('manual approval required')
  })

  test("called with an approval that doesn't match a persisted record throws", async () => {
    setup()
    writeSkillFile('investigate', '# Investigate\n\nstep 1\n')
    writePending('patch-1', SAMPLE_PATCH)
    await recordPatchApproval('patch-1', {
      approvalId: 'patch-1',
      approvedAt: 1_700_000_100_000,
      approvedBy: 'reviewer',
    })
    await expect(
      applySkillPatch(SAMPLE_PATCH, {
        approvalId: 'patch-1',
        approvedAt: 1_700_000_100_001,
        approvedBy: 'reviewer',
      }),
    ).rejects.toThrow(
      'manual approval required: no review record for approvalId=patch-1',
    )
  })

  test('called with a valid approval that matches a persisted record applies the patch', async () => {
    setup()
    const skillPath = writeSkillFile('investigate', '# Investigate\n\nstep 1\n')
    writePending('patch-1', SAMPLE_PATCH)
    const approval = sampleApproval()
    await recordPatchApproval('patch-1', approval)
    const result = await applySkillPatch(SAMPLE_PATCH, approval)
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
    const patch: SkillPatch = {
      skill: 'investigate',
      edits: [
        {
          type: 'refine_step',
          content: 'after step two, also verify env',
          anchor: 'step two',
        },
      ],
    }
    writePending('patch-2', patch)
    const approval = sampleApproval('patch-2')
    await recordPatchApproval('patch-2', approval)
    await applySkillPatch(patch, approval)
    const body = readFileSync(skillPath, 'utf-8')
    const idxTwo = body.indexOf('step two')
    const idxInjected = body.indexOf('after step two')
    const idxThree = body.indexOf('step three')
    expect(idxTwo).toBeLessThan(idxInjected)
    expect(idxInjected).toBeLessThan(idxThree)
  })

  test('throws if live skill file is missing', async () => {
    setup()
    writePending('patch-1', SAMPLE_PATCH)
    const approval = sampleApproval()
    await recordPatchApproval('patch-1', approval)
    await expect(applySkillPatch(SAMPLE_PATCH, approval)).rejects.toBeInstanceOf(
      SkillPatchApplyError,
    )
  })
})
