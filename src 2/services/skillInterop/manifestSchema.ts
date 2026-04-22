import { z } from 'zod'

// KAIROS pins the public Agent Skills discovery index v0.2.0 for interop.
// We additionally allow `data:` and `file:` artifact URLs so exported manifests
// stay self-contained and lintable offline.
export const AGENTSKILLS_DISCOVERY_SCHEMA_V0_2_0 =
  'https://schemas.agentskills.io/discovery/0.2.0/schema.json'

export const SUPPORTED_MANIFEST_SCHEMA_VERSIONS = new Set([
  AGENTSKILLS_DISCOVERY_SCHEMA_V0_2_0,
])

export const SKILL_NAME_REGEX = /^(?!-)(?!.*--)[a-z0-9-]{1,64}(?<!-)$/
export const SHA256_DIGEST_REGEX = /^sha256:[0-9a-f]{64}$/
export const MAX_SKILL_BODY_BYTES = 64 * 1024

export const discoverySkillEntrySchema = z.object({
  name: z.string().regex(SKILL_NAME_REGEX),
  type: z.enum(['skill-md', 'archive']),
  description: z.string().min(1).max(1024),
  url: z.string().min(1),
  digest: z.string().regex(SHA256_DIGEST_REGEX),
})

export const discoveryManifestSchema = z.object({
  $schema: z.literal(AGENTSKILLS_DISCOVERY_SCHEMA_V0_2_0),
  skills: z.array(discoverySkillEntrySchema).min(1),
})

export type DiscoverySkillEntry = z.infer<typeof discoverySkillEntrySchema>
export type DiscoveryManifest = z.infer<typeof discoveryManifestSchema>
