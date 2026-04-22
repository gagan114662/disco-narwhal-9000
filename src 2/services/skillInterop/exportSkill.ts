import { jsonStringify } from '../../utils/slowOperations.js'
import {
  AGENTSKILLS_DISCOVERY_SCHEMA_V0_2_0,
} from './manifestSchema.js'
import { readLocalSkillDocument, validateSkillDocument, computeSkillChecksum } from './shared.js'

export async function exportSkill(reference: string): Promise<string> {
  const skill = await readLocalSkillDocument(reference)
  const violations = validateSkillDocument(skill)
  if (violations.length > 0) {
    const message = violations.map(v => `${v.path}: ${v.message}`).join('\n')
    throw new Error(`Cannot export invalid skill:\n${message}`)
  }

  const manifest = {
    $schema: AGENTSKILLS_DISCOVERY_SCHEMA_V0_2_0,
    skills: [
      {
        name: skill.name,
        type: 'skill-md' as const,
        description: skill.description,
        url: `data:text/markdown;base64,${skill.rawBytes.toString('base64')}`,
        digest: computeSkillChecksum(skill.rawBytes),
      },
    ],
  }

  return `${jsonStringify(manifest, null, 2)}\n`
}
