// Apply an accepted SkillPatch to the live skill file.
//
// Safety invariants (non-negotiable — enforced in this order):
//   1. Target path must resolve strictly inside ~/.claude/skills/.
//   2. Pre-apply, copy the live file to backups/<skill>-<iso>.md.
//   3. v1 is additive — refuse to apply if the diff would delete >10 lines.
//
// Implementation: edits are all additive (add_note / refine_step /
// add_example) so the applied result is the original text + appended or
// anchored sections. "refine_step" with an anchor inserts content
// immediately after the first line matching the anchor; without an anchor
// it falls back to append. Nothing is ever removed.

import { copyFile, mkdir, readFile, writeFile } from 'fs/promises'
import { resolve, sep } from 'path'
import { isFsInaccessible } from '../../utils/errors.js'
import {
  getBackupPath,
  getBackupsDir,
  getSkillFilePath,
  getSkillsRoot,
} from './paths.js'
import type { SkillEdit, SkillPatch } from './patchSchema.js'

export const MAX_DELETION_LINES = 10

export class SkillPatchApplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillPatchApplyError'
  }
}

function isInsideSkillsRoot(path: string): boolean {
  const root = resolve(getSkillsRoot()) + sep
  const resolved = resolve(path)
  return resolved === resolve(getSkillsRoot()) || resolved.startsWith(root)
}

function countLineDelta(before: string, after: string): number {
  // Deletion lines = max(0, beforeLines - afterLines). Additive-only applies
  // always yield a non-negative delta; this function still exists so that a
  // buggy apply step that *did* remove text would be caught before write.
  const beforeLines = before.split('\n').length
  const afterLines = after.split('\n').length
  return Math.max(0, beforeLines - afterLines)
}

function renderEdit(edit: SkillEdit): string {
  switch (edit.type) {
    case 'add_note':
      return `\n\n> [!note] KAIROS skill-learning\n${edit.content
        .split('\n')
        .map(l => `> ${l}`)
        .join('\n')}\n`
    case 'add_example':
      return `\n\n### Example (added by KAIROS)\n${edit.content}\n`
    case 'refine_step':
      return `\n\n> [!tip] KAIROS skill-learning refinement\n${edit.content
        .split('\n')
        .map(l => `> ${l}`)
        .join('\n')}\n`
  }
}

function applyOneEdit(text: string, edit: SkillEdit): string {
  const rendered = renderEdit(edit)
  if (edit.type !== 'refine_step' || !edit.anchor) {
    return `${text.trimEnd()}${rendered}\n`
  }
  const lines = text.split('\n')
  const idx = lines.findIndex(l => l.includes(edit.anchor!))
  if (idx === -1) {
    return `${text.trimEnd()}${rendered}\n`
  }
  const before = lines.slice(0, idx + 1).join('\n')
  const after = lines.slice(idx + 1).join('\n')
  return `${before}${rendered}${after.length > 0 ? '\n' + after : '\n'}`
}

export type ApplySkillPatchResult = {
  skillPath: string
  backupPath: string
  editsApplied: number
}

/**
 * Apply a validated patch to its live skill file. Throws
 * SkillPatchApplyError if any safety check fails (target outside skills
 * root, deletion rule tripped).
 */
export async function applySkillPatch(
  patch: SkillPatch,
  now: Date = new Date(),
): Promise<ApplySkillPatchResult> {
  const skillPath = getSkillFilePath(patch.skill)
  if (!isInsideSkillsRoot(skillPath)) {
    throw new SkillPatchApplyError(
      `refusing to apply: skill path escapes skills root (${skillPath})`,
    )
  }

  let original: string
  try {
    original = await readFile(skillPath, 'utf-8')
  } catch (e) {
    if (isFsInaccessible(e)) {
      throw new SkillPatchApplyError(
        `cannot apply patch: live skill file not found at ${skillPath}`,
      )
    }
    throw e
  }

  const backupPath = getBackupPath(patch.skill, now.toISOString())
  await mkdir(getBackupsDir(), { recursive: true })
  await copyFile(skillPath, backupPath)

  let next = original
  for (const edit of patch.edits) {
    next = applyOneEdit(next, edit)
  }

  const delta = countLineDelta(original, next)
  if (delta > MAX_DELETION_LINES) {
    throw new SkillPatchApplyError(
      `refusing to apply: patch would remove ${delta} lines (> ${MAX_DELETION_LINES})`,
    )
  }

  await writeFile(skillPath, next, 'utf-8')
  return {
    skillPath,
    backupPath,
    editsApplied: patch.edits.length,
  }
}
