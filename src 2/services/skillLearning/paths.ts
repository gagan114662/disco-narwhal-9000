// Canonical on-disk layout for the skill-learning review queue.
//
// Layout under ~/.claude/skills/.pending-improvements/:
//   <id>.json              — patch awaiting review
//   applied/<id>.json      — accepted; backup of live skill is in backups/
//   rejected/<id>.json     — rejected; kept for audit
//   archive/<id>.json      — accepted long ago; kept for audit but excluded
//                            from rate-limit reads so the hot path stays O(1)
//   backups/<skill>-<ts>.md — snapshot of the live skill file pre-apply

import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export const PENDING_DIR_NAME = '.pending-improvements'

export function getSkillsRoot(): string {
  return join(getClaudeConfigHomeDir(), 'skills')
}

export function getPendingImprovementsDir(): string {
  return join(getSkillsRoot(), PENDING_DIR_NAME)
}

export function getAppliedDir(): string {
  return join(getPendingImprovementsDir(), 'applied')
}

export function getRejectedDir(): string {
  return join(getPendingImprovementsDir(), 'rejected')
}

export function getBackupsDir(): string {
  return join(getPendingImprovementsDir(), 'backups')
}

export function getArchiveDir(): string {
  return join(getPendingImprovementsDir(), 'archive')
}

export function getArchivePatchPath(id: string): string {
  return join(getArchiveDir(), `${id}.json`)
}

export function getPendingPatchPath(id: string): string {
  return join(getPendingImprovementsDir(), `${id}.json`)
}

export function getAppliedPatchPath(id: string): string {
  return join(getAppliedDir(), `${id}.json`)
}

export function getRejectedPatchPath(id: string): string {
  return join(getRejectedDir(), `${id}.json`)
}

/** Path to a skill's live SKILL.md in the user skills root. */
export function getSkillFilePath(skillName: string): string {
  return join(getSkillsRoot(), skillName, 'SKILL.md')
}

export function getBackupPath(skillName: string, iso: string): string {
  // ISO timestamps contain colons and dots — map to filesystem-safe runs.
  const safe = iso.replace(/[:.]/g, '-')
  return join(getBackupsDir(), `${skillName}-${safe}.md`)
}
