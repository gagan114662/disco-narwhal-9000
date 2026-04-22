// Rate-limit distillation-per-skill to one patch per configurable window.
//
// Checks BOTH pending and applied patches — a patch sitting unreviewed
// still counts against the budget, otherwise the queue can pile up while
// the user is away. Rejected patches DO NOT count (the skill effectively
// had no learning this cycle, so we can try again).

import { mkdir, readdir, readFile, rename } from 'fs/promises'
import { join } from 'path'
import { isFsInaccessible } from '../../utils/errors.js'
import {
  getAppliedDir,
  getArchiveDir,
  getArchivePatchPath,
  getPendingImprovementsDir,
} from './paths.js'
import { SkillPatchSchema } from './patchSchema.js'

export type StoredPatchMeta = {
  id: string
  skill: string
  createdAt: number
  status: 'pending' | 'applied'
}

async function readDirSafe(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (e) {
    if (isFsInaccessible(e)) return []
    throw e
  }
}

async function readPatchMeta(
  path: string,
  status: 'pending' | 'applied',
): Promise<StoredPatchMeta | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const rec = parsed as Record<string, unknown>
  if (typeof rec.id !== 'string' || typeof rec.createdAt !== 'number') return null
  // Validate skill field independently — a malformed patch on disk should be
  // skipped but not crash the rate limiter.
  const patchCheck = SkillPatchSchema.safeParse(rec.patch)
  if (!patchCheck.success) return null
  return {
    id: rec.id,
    skill: patchCheck.data.skill,
    createdAt: rec.createdAt,
    status,
  }
}

async function listMetaIn(
  dir: string,
  status: 'pending' | 'applied',
): Promise<StoredPatchMeta[]> {
  const entries = await readDirSafe(dir)
  const out: StoredPatchMeta[] = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const meta = await readPatchMeta(join(dir, name), status)
    if (meta) out.push(meta)
  }
  return out
}

/** All pending + applied patches across the queue, union. */
export async function listActivePatches(): Promise<StoredPatchMeta[]> {
  const [pending, applied] = await Promise.all([
    listMetaIn(getPendingImprovementsDir(), 'pending'),
    listMetaIn(getAppliedDir(), 'applied'),
  ])
  return [...pending, ...applied]
}

/**
 * Move applied patches older than `cutoffMs` (epoch) into `archive/` so the
 * rate-limit read path stays O(recent-applied) instead of O(all-time
 * applied). Archived patches are still on disk for audit — they're just
 * invisible to `listActivePatches`. Callers typically pass
 * `nowMs - rateLimitMs * 2` as the cutoff so anything too old to affect
 * rate limits anyway gets moved out.
 *
 * Best-effort — silently skips individual failures (missing files, race
 * with another caller, fs errors on rename). The rate limiter's correctness
 * does not depend on archiving succeeding.
 */
export async function archiveOldAppliedPatches(cutoffMs: number): Promise<number> {
  const entries = await readDirSafe(getAppliedDir())
  if (entries.length === 0) return 0
  let moved = 0
  let ensuredDir = false
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const src = join(getAppliedDir(), name)
    const meta = await readPatchMeta(src, 'applied')
    if (!meta || meta.createdAt >= cutoffMs) continue
    if (!ensuredDir) {
      try {
        await mkdir(getArchiveDir(), { recursive: true })
        ensuredDir = true
      } catch {
        return moved
      }
    }
    const id = name.slice(0, -5)
    try {
      await rename(src, getArchivePatchPath(id))
      moved += 1
    } catch {
      // Another caller raced us or the file vanished — fine, skip.
    }
  }
  return moved
}

export type RateLimitCheck =
  | { ok: true }
  | { ok: false; reason: 'rate_limited'; lastAt: number; nextAllowedAt: number }

/**
 * True when this skill may be re-distilled. A prior pending or applied patch
 * within `windowMs` blocks; anything older (or rejected) does not.
 */
export async function checkSkillRateLimit(
  skill: string,
  nowMs: number,
  windowMs: number,
): Promise<RateLimitCheck> {
  if (windowMs <= 0) return { ok: true }
  const active = await listActivePatches()
  const matching = active.filter(p => p.skill === skill)
  if (matching.length === 0) return { ok: true }
  const latest = matching.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
  const nextAllowedAt = latest.createdAt + windowMs
  if (nowMs >= nextAllowedAt) return { ok: true }
  return {
    ok: false,
    reason: 'rate_limited',
    lastAt: latest.createdAt,
    nextAllowedAt,
  }
}
