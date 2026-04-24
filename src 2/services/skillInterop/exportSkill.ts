import { jsonStringify } from '../../utils/slowOperations.js'
import {
  AGENTSKILLS_DISCOVERY_SCHEMA_V0_2_0,
  type DiscoveryManifest,
} from './manifestSchema.js'
import { readLocalSkillDocument, validateSkillDocument, computeSkillChecksum } from './shared.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

export async function exportSkill(reference: string): Promise<string> {
  const manifest = await buildExportManifest(reference)
  return `${jsonStringify(manifest, null, 2)}\n`
}

export async function publishSkill(
  reference: string,
  options: { now?: Date } = {},
): Promise<string> {
  const manifest = await buildExportManifest(reference)
  const skillName = manifest.skills[0]?.name
  if (!skillName) {
    throw new Error('Cannot publish a manifest without a skill entry.')
  }

  const dir = join(getClaudeConfigHomeDir(), 'kairos', 'skill-publications', skillName)
  const manifestPath = join(dir, 'discovery.json')
  const publicationPath = join(dir, 'publication.json')
  await mkdir(dir, { recursive: true })
  await writeFile(manifestPath, `${jsonStringify(manifest, null, 2)}\n`, 'utf8')
  await writeFile(
    publicationPath,
    `${jsonStringify(
      {
        publishedAt: (options.now ?? new Date()).toISOString(),
        schema: manifest.$schema,
        skill: skillName,
        manifestPath,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  return `Published skill manifest to ${manifestPath}.`
}

async function buildExportManifest(reference: string): Promise<DiscoveryManifest> {
  const skill = await readLocalSkillDocument(reference)
  const violations = validateSkillDocument(skill)
  if (violations.length > 0) {
    const message = violations.map(v => `${v.path}: ${v.message}`).join('\n')
    throw new Error(`Cannot export invalid skill:\n${message}`)
  }

  return {
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
}
