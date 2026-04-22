export type MemoryProposalKind = 'fact' | 'preference' | 'pattern'

export type MemoryProposalInput = {
  kind: MemoryProposalKind
  content: string
  evidence_session_id: string
}

export type SessionSummary = {
  session_id: string
  project: string
  when: string
  one_liner: string
  topics: string[]
  decisions: string[]
  open_loops: string[]
}

const MAX_PROPOSAL_CONTENT = 280

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function validateMemoryProposal(
  proposal: MemoryProposalInput,
): MemoryProposalInput {
  const content = compactWhitespace(proposal.content)
  if (!content) {
    throw new Error('Memory proposal content must be non-empty.')
  }
  if (content.length > MAX_PROPOSAL_CONTENT) {
    throw new Error(
      `Memory proposal content must be <= ${MAX_PROPOSAL_CONTENT} characters.`,
    )
  }
  return {
    kind: proposal.kind,
    content,
    evidence_session_id: compactWhitespace(proposal.evidence_session_id),
  }
}

export function chooseMemoryTargetFile(kind: MemoryProposalKind): 'MEMORY.md' | 'USER.md' {
  return kind === 'fact' ? 'MEMORY.md' : 'USER.md'
}

function detectKind(content: string): MemoryProposalKind | null {
  const lower = content.toLowerCase()
  if (
    lower.includes('prefer ') ||
    lower.includes('preference') ||
    lower.includes('likes ')
  ) {
    return 'preference'
  }
  if (
    lower.includes('always ') ||
    lower.includes('workflow') ||
    lower.includes('pattern') ||
    lower.includes('usually ')
  ) {
    return 'pattern'
  }
  if (
    lower.includes('use ') ||
    lower.includes('uses ') ||
    lower.includes('stores ') ||
    lower.includes('lives ') ||
    lower.includes('is ')
  ) {
    return 'fact'
  }
  return null
}

function pickCandidates(summary: SessionSummary): string[] {
  return [...summary.decisions, ...summary.open_loops].map(compactWhitespace)
}

export function deriveMemoryProposalsFromSummary(
  summary: SessionSummary,
): MemoryProposalInput[] {
  const seen = new Set<string>()
  const proposals: MemoryProposalInput[] = []

  for (const candidate of pickCandidates(summary)) {
    if (!candidate) continue
    const kind = detectKind(candidate)
    if (kind === null) continue
    const content = candidate.endsWith('.') ? candidate : `${candidate}.`
    const key = `${kind}:${content.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    proposals.push(
      validateMemoryProposal({
        kind,
        content,
        evidence_session_id: summary.session_id,
      }),
    )
    if (proposals.length >= 3) {
      break
    }
  }

  return proposals
}
