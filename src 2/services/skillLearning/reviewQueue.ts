// Browse and mutate the pending-improvements queue from the command line.
//
// On-disk layout (see paths.ts):
//   <id>.json             — pending
//   applied/<id>.json     — accepted and written back to live skill
//   rejected/<id>.json    — rejected, kept for audit
//   backups/<skill>-<ts>.md — pre-apply snapshots

import { readdir, readFile, rename } from 'fs/promises'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { isFsInaccessible } from '../../utils/errors.js'
import {
  getAppliedDir,
  getAppliedPatchPath,
  getPendingImprovementsDir,
  getPendingPatchPath,
  getRejectedDir,
  getRejectedPatchPath,
} from './paths.js'
import { SkillPatchSchema, type SkillPatch } from './patchSchema.js'

export type StoredPatch = {
  id: string
  createdAt: number
  patch: SkillPatch
  status: 'pending' | 'applied' | 'rejected'
  path: string
}

async function readJsonSafe(path: string): Promise<unknown | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw)
  } catch (e) {
    if (isFsInaccessible(e)) return null
    return null
  }
}

function parseStored(
  id: string,
  raw: unknown,
  status: StoredPatch['status'],
  path: string,
): StoredPatch | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (typeof rec.createdAt !== 'number') return null
  const patch = SkillPatchSchema.safeParse(rec.patch)
  if (!patch.success) return null
  return {
    id,
    createdAt: rec.createdAt,
    patch: patch.data,
    status,
    path,
  }
}

async function readStoredIn(
  dir: string,
  status: StoredPatch['status'],
): Promise<StoredPatch[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (e) {
    if (isFsInaccessible(e)) return []
    return []
  }
  const out: StoredPatch[] = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const id = name.slice(0, -5)
    const path = join(dir, name)
    const raw = await readJsonSafe(path)
    const stored = parseStored(id, raw, status, path)
    if (stored) out.push(stored)
  }
  return out
}

export async function listPendingPatches(): Promise<StoredPatch[]> {
  const list = await readStoredIn(getPendingImprovementsDir(), 'pending')
  return list.sort((a, b) => b.createdAt - a.createdAt)
}

export async function loadPatchById(id: string): Promise<StoredPatch | null> {
  // Check pending first (hot path), then applied/rejected for historical.
  for (const [dir, status] of [
    [getPendingImprovementsDir(), 'pending'],
    [getAppliedDir(), 'applied'],
    [getRejectedDir(), 'rejected'],
  ] as const) {
    const path = join(dir, `${id}.json`)
    const raw = await readJsonSafe(path)
    if (!raw) continue
    const stored = parseStored(id, raw, status, path)
    if (stored) return stored
  }
  return null
}

/**
 * Move a pending patch to `applied/` or `rejected/`. Does NOT touch the live
 * skill file — that's `applyPatch.ts`'s job; acceptance calls it before
 * calling this. Rejection just moves the file; no skill changes.
 */
export async function movePatchTo(
  id: string,
  target: 'applied' | 'rejected',
): Promise<void> {
  const from = getPendingPatchPath(id)
  const toDir = target === 'applied' ? getAppliedDir() : getRejectedDir()
  const to =
    target === 'applied'
      ? getAppliedPatchPath(id)
      : getRejectedPatchPath(id)
  await mkdir(toDir, { recursive: true })
  await rename(from, to)
}

/**
 * Render a simple unified-ish diff of the edits in a patch for the CLI's
 * `diff` subcommand. Not a real git diff — each edit gets a header and the
 * new content. Kept narrow because v1 is additive-only.
 */
export function renderPatchDiff(patch: SkillPatch): string {
  const lines: string[] = []
  lines.push(`# Skill: ${patch.skill}`)
  if (patch.summary) lines.push(`# Summary: ${patch.summary}`)
  lines.push('')
  for (let i = 0; i < patch.edits.length; i += 1) {
    const edit = patch.edits[i]!
    lines.push(`## Edit ${i + 1}: ${edit.type}`)
    if (edit.anchor) lines.push(`anchor: ${edit.anchor}`)
    if (edit.rationale) lines.push(`rationale: ${edit.rationale}`)
    lines.push('---')
    for (const line of edit.content.split('\n')) {
      lines.push(`+ ${line}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
