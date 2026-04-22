import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  chooseMemoryTargetFile,
  type MemoryProposalInput,
  validateMemoryProposal,
} from './curationProposer.js'
import {
  ensureKairosMemoryDirs,
  getArchivedProposalDir,
  getMemoryBackupDir,
  getPendingProposalDir,
  wipeKairosMemoryArtifacts,
} from './paths.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export type StoredMemoryProposal = MemoryProposalInput & {
  id: string
  createdAt: string
}

type ArchivedProposal = StoredMemoryProposal & {
  archivedAt: string
  disposition: 'accepted' | 'rejected'
}

function getPendingProposalPath(id: string): string {
  return join(getPendingProposalDir(), `${id}.json`)
}

function getArchivedProposalPath(id: string): string {
  return join(getArchivedProposalDir(), `${id}.json`)
}

function sortByMtimeDesc(paths: string[]): string[] {
  return [...paths].sort(
    (left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs,
  )
}

function readProposalFile(path: string): StoredMemoryProposal {
  return JSON.parse(readFileSync(path, 'utf8')) as StoredMemoryProposal
}

function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

function ensureTargetMemoryFile(fileName: 'MEMORY.md' | 'USER.md'): string {
  const targetPath = join(getClaudeConfigHomeDir(), fileName)
  mkdirSync(getClaudeConfigHomeDir(), { recursive: true, mode: 0o700 })
  if (!existsSync(targetPath)) {
    writeFileSync(targetPath, '', { encoding: 'utf8', mode: 0o600 })
  }
  return targetPath
}

function backupMemoryFile(targetPath: string): string {
  ensureKairosMemoryDirs()
  const backupPath = join(
    getMemoryBackupDir(),
    `${basename(targetPath)}.${Date.now()}.bak`,
  )
  copyFileSync(targetPath, backupPath)
  return backupPath
}

export function queueMemoryProposal(
  proposal: MemoryProposalInput,
  deps: { generateId?: () => string; now?: Date } = {},
): StoredMemoryProposal {
  ensureKairosMemoryDirs()
  const validated = validateMemoryProposal(proposal)
  const id = deps.generateId?.() ?? randomUUID().slice(0, 8)
  const stored: StoredMemoryProposal = {
    ...validated,
    id,
    createdAt: (deps.now ?? new Date()).toISOString(),
  }
  writeJsonFile(getPendingProposalPath(id), stored)
  return stored
}

export function listPendingMemoryProposals(): StoredMemoryProposal[] {
  ensureKairosMemoryDirs()
  const files = readdirSync(getPendingProposalDir())
    .filter(file => file.endsWith('.json'))
    .map(file => join(getPendingProposalDir(), file))
  return sortByMtimeDesc(files).map(readProposalFile)
}

export function getPendingMemoryProposal(
  id: string,
): StoredMemoryProposal | null {
  const path = getPendingProposalPath(id)
  if (!existsSync(path)) return null
  return readProposalFile(path)
}

function archiveProposal(
  proposal: StoredMemoryProposal,
  disposition: ArchivedProposal['disposition'],
): ArchivedProposal {
  ensureKairosMemoryDirs()
  const archived: ArchivedProposal = {
    ...proposal,
    archivedAt: new Date().toISOString(),
    disposition,
  }
  writeJsonFile(getArchivedProposalPath(proposal.id), archived)
  return archived
}

export function renderMemoryProposalDiff(id: string): string {
  const proposal = getPendingMemoryProposal(id)
  if (!proposal) {
    throw new Error(`No pending proposal with id ${id}.`)
  }
  const targetName = chooseMemoryTargetFile(proposal.kind)
  const targetPath = ensureTargetMemoryFile(targetName)
  const existing = readFileSync(targetPath, 'utf8')
  const line = `- ${proposal.content}`
  const before = existing.trimEnd()
  const after = before ? `${before}\n${line}` : line
  return [
    `Proposal ${proposal.id}`,
    `Target: ${targetPath}`,
    '',
    '--- before',
    before || '(empty)',
    '+++ after',
    after,
  ].join('\n')
}

export function acceptMemoryProposal(id: string): {
  proposal: StoredMemoryProposal
  targetPath: string
  backupPath: string
} {
  const proposal = getPendingMemoryProposal(id)
  if (!proposal) {
    throw new Error(`No pending proposal with id ${id}.`)
  }
  const targetName = chooseMemoryTargetFile(proposal.kind)
  const targetPath = ensureTargetMemoryFile(targetName)
  const backupPath = backupMemoryFile(targetPath)
  const existing = readFileSync(targetPath, 'utf8').trimEnd()
  const nextLine = `- ${proposal.content}`
  const next = existing ? `${existing}\n${nextLine}\n` : `${nextLine}\n`
  writeFileSync(targetPath, next, { encoding: 'utf8', mode: 0o600 })
  archiveProposal(proposal, 'accepted')
  unlinkSync(getPendingProposalPath(id))
  return { proposal, targetPath, backupPath }
}

export function rejectMemoryProposal(id: string): StoredMemoryProposal {
  const proposal = getPendingMemoryProposal(id)
  if (!proposal) {
    throw new Error(`No pending proposal with id ${id}.`)
  }
  archiveProposal(proposal, 'rejected')
  unlinkSync(getPendingProposalPath(id))
  return proposal
}

export function wipeMemoryProposalQueue(): void {
  rmSync(getPendingProposalDir(), { recursive: true, force: true })
  rmSync(getArchivedProposalDir(), { recursive: true, force: true })
}

export function wipeAllKairosMemoryArtifacts(): void {
  wipeKairosMemoryArtifacts()
}
