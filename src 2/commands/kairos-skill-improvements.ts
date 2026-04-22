// Handler for `/kairos skill-improvements {list|diff|accept|reject}`.
//
// Kept in its own file so the parent /kairos dispatcher stays terse and
// this can be unit-tested in isolation.

import { applySkillPatch, SkillPatchApplyError } from '../services/skillLearning/applyPatch.js'
import {
  listPendingPatches,
  loadPatchById,
  movePatchTo,
  renderPatchDiff,
} from '../services/skillLearning/reviewQueue.js'

export type SkillImprovementsAction = 'list' | 'diff' | 'accept' | 'reject'

const ACTIONS = new Set<SkillImprovementsAction>([
  'list',
  'diff',
  'accept',
  'reject',
])

const HELP = `Usage:
/kairos skill-improvements list
/kairos skill-improvements diff <id>
/kairos skill-improvements accept <id>
/kairos skill-improvements reject <id>`

export async function runSkillImprovementsCommand(args: string[]): Promise<string> {
  const [action, id] = args
  if (!action) return HELP
  if (!ACTIONS.has(action as SkillImprovementsAction)) {
    return `unknown subcommand '${action}'\n\n${HELP}`
  }
  switch (action as SkillImprovementsAction) {
    case 'list':
      return handleList()
    case 'diff':
      if (!id) return 'diff requires a patch id'
      return handleDiff(id)
    case 'accept':
      if (!id) return 'accept requires a patch id'
      return handleAccept(id)
    case 'reject':
      if (!id) return 'reject requires a patch id'
      return handleReject(id)
  }
}

async function handleList(): Promise<string> {
  const patches = await listPendingPatches()
  if (patches.length === 0) return 'No pending skill improvements.'
  return patches
    .map(p => {
      const ts = new Date(p.createdAt).toISOString()
      return `${p.id}  ${ts}  ${p.patch.skill}  (${p.patch.edits.length} edit${
        p.patch.edits.length === 1 ? '' : 's'
      })`
    })
    .join('\n')
}

async function handleDiff(id: string): Promise<string> {
  const patch = await loadPatchById(id)
  if (!patch) return `patch ${id} not found`
  return renderPatchDiff(patch.patch)
}

async function handleAccept(id: string): Promise<string> {
  const patch = await loadPatchById(id)
  if (!patch) return `patch ${id} not found`
  if (patch.status !== 'pending') {
    return `patch ${id} is already ${patch.status}`
  }
  try {
    const applied = await applySkillPatch(patch.patch)
    await movePatchTo(id, 'applied')
    return [
      `accepted ${id}`,
      `skill: ${applied.skillPath}`,
      `backup: ${applied.backupPath}`,
      `edits applied: ${applied.editsApplied}`,
    ].join('\n')
  } catch (error) {
    if (error instanceof SkillPatchApplyError) {
      return `failed to apply ${id}: ${error.message}`
    }
    throw error
  }
}

async function handleReject(id: string): Promise<string> {
  const patch = await loadPatchById(id)
  if (!patch) return `patch ${id} not found`
  if (patch.status !== 'pending') {
    return `patch ${id} is already ${patch.status}`
  }
  await movePatchTo(id, 'rejected')
  return `rejected ${id}`
}
