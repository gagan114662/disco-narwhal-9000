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
import { runSkillImprovementsCommand } from './kairos-skill-improvements.js'
import {
  getAppliedPatchPath,
  getPendingPatchPath,
  getRejectedPatchPath,
  getSkillFilePath,
} from '../services/skillLearning/paths.js'

const TEMP_DIRS: string[] = []
const ORIGINAL_CCD = process.env.CLAUDE_CONFIG_DIR

afterEach(() => {
  for (const d of TEMP_DIRS.splice(0)) rmSync(d, { recursive: true, force: true })
  if (ORIGINAL_CCD === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CCD
})

function setup(): string {
  const d = mkdtempSync(join(tmpdir(), 'kairos-sl-cmd-'))
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

function writePending(id: string, skill: string): void {
  writeFileSync(
    getPendingPatchPath(id),
    JSON.stringify({
      id,
      createdAt: 1_700_000_000_000,
      patch: {
        skill,
        edits: [{ type: 'add_note', content: 'remember to check env files' }],
      },
    }),
  )
}

function writeSkill(name: string, body: string): string {
  const p = getSkillFilePath(name)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, body)
  return p
}

describe('runSkillImprovementsCommand', () => {
  test('no args prints help', async () => {
    setup()
    const out = await runSkillImprovementsCommand([])
    expect(out).toContain('Usage:')
    expect(out).toContain('skill-improvements')
  })

  test('list reports empty when no pending patches', async () => {
    setup()
    const out = await runSkillImprovementsCommand(['list'])
    expect(out).toBe('No pending skill improvements.')
  })

  test('list shows pending patches', async () => {
    setup()
    writePending('abc12345', 'investigate')
    const out = await runSkillImprovementsCommand(['list'])
    expect(out).toContain('abc12345')
    expect(out).toContain('investigate')
  })

  test('diff unknown id reports not found', async () => {
    setup()
    const out = await runSkillImprovementsCommand(['diff', 'missing'])
    expect(out).toContain('not found')
  })

  test('diff shows edit blocks for a pending patch', async () => {
    setup()
    writePending('id1', 'investigate')
    const out = await runSkillImprovementsCommand(['diff', 'id1'])
    expect(out).toContain('# Skill: investigate')
    expect(out).toContain('+ remember to check env files')
  })

  test('accept applies patch, moves file, creates backup', async () => {
    setup()
    const skillPath = writeSkill('investigate', '# Investigate\n\nstep 1\n')
    writePending('id2', 'investigate')
    const out = await runSkillImprovementsCommand(['accept', 'id2'])
    expect(out).toContain('accepted id2')
    expect(existsSync(getPendingPatchPath('id2'))).toBe(false)
    expect(existsSync(getAppliedPatchPath('id2'))).toBe(true)
    const body = readFileSync(skillPath, 'utf-8')
    expect(body).toContain('remember to check env files')
  })

  test('reject moves file to rejected without touching skill', async () => {
    setup()
    writeSkill('investigate', '# Investigate\n')
    writePending('id3', 'investigate')
    const out = await runSkillImprovementsCommand(['reject', 'id3'])
    expect(out).toContain('rejected id3')
    expect(existsSync(getRejectedPatchPath('id3'))).toBe(true)
  })

  test('accept fails cleanly when live skill file is missing', async () => {
    setup()
    writePending('id4', 'nonexistent')
    const out = await runSkillImprovementsCommand(['accept', 'id4'])
    expect(out).toContain('failed to apply id4')
    // Patch must remain pending when apply fails.
    expect(existsSync(getPendingPatchPath('id4'))).toBe(true)
  })

  test('rejects unknown action', async () => {
    setup()
    const out = await runSkillImprovementsCommand(['bogus'])
    expect(out).toContain("unknown subcommand 'bogus'")
  })
})
