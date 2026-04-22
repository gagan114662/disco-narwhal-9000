import { describe, expect, test } from 'bun:test'
import { parseSkillPatch, SkillPatchSchema } from './patchSchema.js'

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

describe('parseSkillPatch', () => {
  test('parses raw JSON', () => {
    const patch = parseSkillPatch(
      '{"skill":"x","edits":[{"type":"add_note","content":"y"}]}',
    )
    expect(patch.skill).toBe('x')
  })

  test('strips fenced json', () => {
    const raw = '```json\n{"skill":"x","edits":[{"type":"add_note","content":"y"}]}\n```'
    const patch = parseSkillPatch(raw)
    expect(patch.skill).toBe('x')
  })

  test('handles leading commentary before the json object', () => {
    const raw =
      'Here is the patch:\n{"skill":"x","edits":[{"type":"add_note","content":"y"}]}'
    const patch = parseSkillPatch(raw)
    expect(patch.skill).toBe('x')
  })

  test('throws on malformed JSON', () => {
    expect(() => parseSkillPatch('not json at all')).toThrow()
  })
})
