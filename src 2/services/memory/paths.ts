import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export const DEFAULT_SESSION_MEMORY_RETENTION_DAYS = 90

export function getKairosMemoryRoot(): string {
  return join(getClaudeConfigHomeDir(), 'memory')
}

export function getSessionIndexPath(): string {
  return join(getKairosMemoryRoot(), 'sessions.db')
}

export function getSessionSummariesDir(): string {
  return join(getClaudeConfigHomeDir(), 'sessions', '.summaries')
}

export function getSessionSummaryPath(sessionId: string): string {
  return join(getSessionSummariesDir(), `${sessionId}.json`)
}

export function getPendingProposalDir(): string {
  return join(getKairosMemoryRoot(), '.pending-proposals')
}

export function getArchivedProposalDir(): string {
  return join(getKairosMemoryRoot(), '.archived-proposals')
}

export function getMemoryBackupDir(): string {
  return join(getKairosMemoryRoot(), 'backups')
}

export function ensureKairosMemoryDirs(): void {
  mkdirSync(getKairosMemoryRoot(), { recursive: true, mode: 0o700 })
  mkdirSync(getSessionSummariesDir(), { recursive: true, mode: 0o700 })
  mkdirSync(getPendingProposalDir(), { recursive: true, mode: 0o700 })
  mkdirSync(getArchivedProposalDir(), { recursive: true, mode: 0o700 })
  mkdirSync(getMemoryBackupDir(), { recursive: true, mode: 0o700 })
}

export function wipeKairosMemoryArtifacts(): void {
  rmSync(getSessionIndexPath(), { force: true })
  rmSync(getSessionSummariesDir(), { recursive: true, force: true })
  rmSync(getPendingProposalDir(), { recursive: true, force: true })
  rmSync(getArchivedProposalDir(), { recursive: true, force: true })
}
