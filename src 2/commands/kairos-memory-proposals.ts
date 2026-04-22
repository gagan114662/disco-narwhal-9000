import {
  acceptMemoryProposal,
  listPendingMemoryProposals,
  rejectMemoryProposal,
  renderMemoryProposalDiff,
  wipeAllKairosMemoryArtifacts,
} from '../services/memory/proposalQueue.js'

const MEMORY_PROPOSALS_HELP = `Usage:
/kairos memory-proposals list
/kairos memory-proposals diff <id>
/kairos memory-proposals accept <id>
/kairos memory-proposals reject <id>`

const MEMORY_HELP = `Usage:
/kairos memory wipe --confirm`

export async function runKairosMemoryProposalsCommand(
  rest: string[],
): Promise<string> {
  const [subcommand, id] = rest

  switch (subcommand) {
    case 'list': {
      const proposals = listPendingMemoryProposals()
      if (proposals.length === 0) {
        return 'No pending memory proposals.'
      }
      return proposals
        .map(
          proposal =>
            `- ${proposal.id} [${proposal.kind}] ${proposal.content} (session ${proposal.evidence_session_id})`,
        )
        .join('\n')
    }
    case 'diff': {
      if (!id) return MEMORY_PROPOSALS_HELP
      return renderMemoryProposalDiff(id)
    }
    case 'accept': {
      if (!id) return MEMORY_PROPOSALS_HELP
      const accepted = acceptMemoryProposal(id)
      return [
        `Accepted proposal ${accepted.proposal.id}.`,
        `Updated: ${accepted.targetPath}`,
        `Backup: ${accepted.backupPath}`,
      ].join('\n')
    }
    case 'reject': {
      if (!id) return MEMORY_PROPOSALS_HELP
      const rejected = rejectMemoryProposal(id)
      return `Rejected proposal ${rejected.id}.`
    }
    default:
      return MEMORY_PROPOSALS_HELP
  }
}

export async function runKairosMemoryCommand(rest: string[]): Promise<string> {
  const [subcommand, confirm] = rest
  if (subcommand !== 'wipe') {
    return MEMORY_HELP
  }
  if (confirm !== '--confirm') {
    return 'Refusing to wipe memory without --confirm.'
  }
  wipeAllKairosMemoryArtifacts()
  return 'Wiped KAIROS session index, summaries, and proposal queue.'
}
