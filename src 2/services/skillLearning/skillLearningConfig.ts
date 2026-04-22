// Read `settings.kairos.skillLearning.*` across the three settings files
// (user / project / project.local) without going through the zod schema.
//
// This mirrors daemon/kairos/tier3.ts: the settings type-system lives in the
// trunk-guarded schemas, but this is a leaf feature, so we walk raw JSON.
// Later-written files override earlier ones, same precedence as tier3.

import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { parseSettingsFile } from '../../utils/settings/settings.js'
import { clearCachedParsedFile } from '../../utils/settings/settingsCache.js'

export type SkillLearningConfig = {
  enabled: boolean
  /** Cost ceiling for a single distillation child run (USD). */
  costCeilingUSD: number
  /** Short token budget; surfaced to the child via maxTurns. */
  maxTurns: number
  /** Hard wall-clock cap so a runaway child can't block the daemon. */
  timeoutMs: number
  /** Minimum ms between two distillations of the same skill. */
  rateLimitMs: number
}

const DEFAULT_CONFIG: SkillLearningConfig = {
  enabled: false,
  costCeilingUSD: 0.05,
  maxTurns: 3,
  timeoutMs: 90_000,
  rateLimitMs: 24 * 60 * 60 * 1000,
}

function getSettingsPaths(projectDir: string): string[] {
  return [
    join(getClaudeConfigHomeDir(), 'settings.json'),
    join(projectDir, '.claude', 'settings.json'),
    join(projectDir, '.claude', 'settings.local.json'),
  ]
}

function readPartial(settings: unknown): Partial<SkillLearningConfig> {
  if (!settings || typeof settings !== 'object') return {}
  const kairos = (settings as Record<string, unknown>).kairos
  if (!kairos || typeof kairos !== 'object') return {}
  const skill = (kairos as Record<string, unknown>).skillLearning
  if (!skill || typeof skill !== 'object') return {}
  const rec = skill as Record<string, unknown>
  const out: Partial<SkillLearningConfig> = {}
  if (typeof rec.enabled === 'boolean') out.enabled = rec.enabled
  if (
    typeof rec.costCeilingUSD === 'number' &&
    Number.isFinite(rec.costCeilingUSD) &&
    rec.costCeilingUSD > 0
  ) {
    out.costCeilingUSD = rec.costCeilingUSD
  }
  if (
    typeof rec.maxTurns === 'number' &&
    Number.isInteger(rec.maxTurns) &&
    rec.maxTurns > 0
  ) {
    out.maxTurns = rec.maxTurns
  }
  if (
    typeof rec.timeoutMs === 'number' &&
    Number.isFinite(rec.timeoutMs) &&
    rec.timeoutMs > 0
  ) {
    out.timeoutMs = rec.timeoutMs
  }
  if (
    typeof rec.rateLimitMs === 'number' &&
    Number.isFinite(rec.rateLimitMs) &&
    rec.rateLimitMs >= 0
  ) {
    out.rateLimitMs = rec.rateLimitMs
  }
  return out
}

export function readSkillLearningConfig(
  projectDir: string,
): SkillLearningConfig {
  let merged: SkillLearningConfig = { ...DEFAULT_CONFIG }
  for (const path of getSettingsPaths(projectDir)) {
    clearCachedParsedFile(path)
    const { settings } = parseSettingsFile(path)
    const partial = readPartial(settings)
    merged = { ...merged, ...partial }
  }
  return merged
}
