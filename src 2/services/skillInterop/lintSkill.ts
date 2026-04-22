import { readFile } from 'fs/promises'
import { readLocalSkillDocument, readManifestArtifactForLint, type SkillInteropViolation, validateSkillDocument } from './shared.js'

export type LintSkillResult = {
  ok: boolean
  violations: SkillInteropViolation[]
}

export async function lintSkill(target: string): Promise<LintSkillResult> {
  const trimmed = target.trim()
  if (!trimmed) {
    throw new Error('Missing lint target.')
  }

  if (trimmed.startsWith('{')) {
    const manifestResult = await readManifestArtifactForLint(trimmed)
    return combineManifestLintResult(manifestResult)
  }

  try {
    const raw = await readFile(trimmed, 'utf8')
    if (raw.trim().startsWith('{')) {
      const manifestResult = await readManifestArtifactForLint(raw)
      return combineManifestLintResult(manifestResult)
    }
  } catch {
    // Fall through to local skill resolution by name/path.
  }

  const skill = await readLocalSkillDocument(trimmed)
  const violations = validateSkillDocument(skill)
  return {
    ok: violations.length === 0,
    violations,
  }
}

function combineManifestLintResult(result: {
  manifestViolations: SkillInteropViolation[]
  skillViolations: SkillInteropViolation[]
}): LintSkillResult {
  const violations = [...result.manifestViolations, ...result.skillViolations]
  return {
    ok: violations.length === 0,
    violations,
  }
}
