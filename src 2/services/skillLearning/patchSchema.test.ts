import { describe, expect, test } from 'bun:test'
import { SkillPatchSchema } from './patchSchema.js'

describe('SkillPatchSchema', () => {
  test('accepts minimal valid patch', () => {
    const ok = SkillPatchSchema.parse({
      skill: 'investigate',
      edits: [{ type: 'add_note', content: 'remember to check env files' }],
    })
    expect(ok.skill).toBe('investigate')
    expect(ok.edits).toHaveLength(1)
  })

  test('rejects skill with path traversal', () => {
    expect(() =>
      SkillPatchSchema.parse({
        skill: '../etc/passwd',
        edits: [{ type: 'add_note', content: 'x' }],
      }),
    ).toThrow()
  })

  test('rejects unknown edit type', () => {
    expect(() =>
      SkillPatchSchema.parse({
        skill: 'x',
        edits: [{ type: 'replace_all', content: 'nope' }],
      }),
    ).toThrow()
  })

  test('rejects zero edits', () => {
    expect(() =>
      SkillPatchSchema.parse({ skill: 'x', edits: [] }),
    ).toThrow()
  })

  test('rejects too many edits', () => {
    const edits = Array.from({ length: 7 }, () => ({
      type: 'add_note' as const,
      content: 'x',
    }))
    expect(() => SkillPatchSchema.parse({ skill: 'x', edits })).toThrow()
  })

  test('rejects oversized content', () => {
    const big = 'x'.repeat(3000)
    expect(() =>
      SkillPatchSchema.parse({
        skill: 'x',
        edits: [{ type: 'add_note', content: big }],
      }),
    ).toThrow()
  })
})
