import {
  appendImportTelemetryEvent,
  buildDiffPreview,
  getImportedSkillPaths,
  readExistingImport,
  resolveSkillSource,
  writeImportedSkill,
  type ResolvedSkillSource,
} from './shared.js'
import { scanSuspiciousSkillContent } from './suspiciousPatterns.js'

type ImportSkillOptions = {
  confirm?: boolean
  overwrite?: boolean
  fetchImpl?: typeof fetch
  now?: Date
}

export async function importSkill(
  input: string,
  options: ImportSkillOptions = {},
): Promise<string> {
  const resolved = await resolveSkillSource(input, {
    fetchImpl: options.fetchImpl,
  })
  const suspiciousHits = scanSuspiciousSkillContent(resolved.skill.markdown)
  const existing = await readExistingImport(resolved.sourceHost, resolved.skill.name)
  const paths = getImportedSkillPaths(resolved.sourceHost, resolved.skill.name)

  if (existing.checksum === resolved.checksum) {
    return `Skill already imported at ${paths.dir}.`
  }

  if (
    existing.checksum &&
    existing.checksum !== resolved.checksum &&
    !options.overwrite
  ) {
    throw new Error(
      `checksum mismatch, use --overwrite to replace ${paths.dir}`,
    )
  }

  const preview = buildImportPreview({
    resolved,
    existingMarkdown: existing.markdown ?? '',
    suspiciousLabels: suspiciousHits.map(hit => hit.label),
    destination: paths.dir,
    overwrite: Boolean(existing.checksum),
  })

  if (!options.confirm) {
    return `${preview}\n\nRe-run with --yes to write the imported skill.`
  }

  const importedAt = (options.now ?? new Date()).toISOString()
  await writeImportedSkill(resolved, {
    source: resolved.sourceDisplay,
    sourceKind: resolved.sourceKind,
    sourceHost: resolved.sourceHost,
    manifestSchema: resolved.manifestSchema,
    manifestUrl: resolved.manifestUrl,
    artifactUrl: resolved.artifactUrl,
    checksum: resolved.checksum,
    importedAt,
  })

  await appendImportTelemetryEvent({
    event: 'kairos_skill_import',
    timestamp: importedAt,
    outcome: existing.checksum ? 'overwritten' : 'imported',
    source_kind: resolved.sourceKind,
    source: resolved.sourceDisplay,
    source_host: resolved.sourceHost,
    manifest_schema: resolved.manifestSchema,
    manifest_url: resolved.manifestUrl,
    artifact_url: resolved.artifactUrl,
    skill_name: resolved.skill.name,
    checksum: resolved.checksum,
    suspicious_pattern_ids: suspiciousHits.map(hit => hit.id),
    suspicious_pattern_count: suspiciousHits.length,
    destination: paths.dir,
  })

  const status = existing.checksum ? 'Overwrote' : 'Imported'
  const warningSuffix =
    suspiciousHits.length > 0
      ? ` Warning: flagged ${suspiciousHits.length} suspicious pattern(s).`
      : ''

  return `${status} skill to ${paths.dir}.${warningSuffix}`
}

function buildImportPreview(input: {
  resolved: ResolvedSkillSource
  existingMarkdown: string
  suspiciousLabels: string[]
  destination: string
  overwrite: boolean
}): string {
  const lines = [
    'Import preview',
    `source: ${input.resolved.sourceDisplay}`,
    `name: ${input.resolved.skill.name}`,
    `description: ${input.resolved.skill.description}`,
    `checksum: ${input.resolved.checksum}`,
    `destination: ${input.destination}`,
    `mode: ${input.overwrite ? 'overwrite' : 'new import'}`,
  ]

  if (input.resolved.manifestSchema) {
    lines.push(`manifest: ${input.resolved.manifestSchema}`)
  }

  if (input.suspiciousLabels.length > 0) {
    lines.push('suspicious patterns:')
    for (const label of input.suspiciousLabels) {
      lines.push(`- ${label}`)
    }
  }

  lines.push('diff:')
  lines.push(buildDiffPreview(input.existingMarkdown, input.resolved.skill.markdown))
  return lines.join('\n')
}
