import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSkillLearningConfig } from './skillLearningConfig.js'

const TEMP_DIRS: string[] = []
const ORIGINAL_CCD = process.env.CLAUDE_CONFIG_DIR

afterEach(() => {
  for (const d of TEMP_DIRS.splice(0)) rmSync(d, { recursive: true, force: true })
  if (ORIGINAL_CCD === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CCD
})

function makeProjectDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'kairos-sl-cfg-'))
  TEMP_DIRS.push(d)
  mkdirSync(join(d, '.claude'), { recursive: true })
  return d
}

function makeUserConfigDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'kairos-sl-cfg-user-'))
  TEMP_DIRS.push(d)
  process.env.CLAUDE_CONFIG_DIR = d
  return d
}

describe('readSkillLearningConfig', () => {
  test('returns defaults (disabled) when no settings file exists', () => {
    makeUserConfigDir()
    const projectDir = makeProjectDir()
    const cfg = readSkillLearningConfig(projectDir)
    expect(cfg.enabled).toBe(false)
    expect(cfg.costCeilingUSD).toBe(0.05)
    expect(cfg.rateLimitMs).toBe(24 * 60 * 60 * 1000)
  })

  test('reads enabled=true from project settings', () => {
    makeUserConfigDir()
    const projectDir = makeProjectDir()
    writeFileSync(
      join(projectDir, '.claude', 'settings.json'),
      JSON.stringify({ kairos: { skillLearning: { enabled: true } } }),
    )
    const cfg = readSkillLearningConfig(projectDir)
    expect(cfg.enabled).toBe(true)
  })

  test('local settings override project settings', () => {
    makeUserConfigDir()
    const projectDir = makeProjectDir()
    writeFileSync(
      join(projectDir, '.claude', 'settings.json'),
      JSON.stringify({ kairos: { skillLearning: { enabled: true } } }),
    )
    writeFileSync(
      join(projectDir, '.claude', 'settings.local.json'),
      JSON.stringify({ kairos: { skillLearning: { enabled: false } } }),
    )
    const cfg = readSkillLearningConfig(projectDir)
    expect(cfg.enabled).toBe(false)
  })

  test('ignores non-positive cost ceiling, keeps default', () => {
    makeUserConfigDir()
    const projectDir = makeProjectDir()
    writeFileSync(
      join(projectDir, '.claude', 'settings.json'),
      JSON.stringify({
        kairos: { skillLearning: { enabled: true, costCeilingUSD: 0 } },
      }),
    )
    const cfg = readSkillLearningConfig(projectDir)
    expect(cfg.costCeilingUSD).toBe(0.05)
  })

  test('accepts a valid custom rate limit', () => {
    makeUserConfigDir()
    const projectDir = makeProjectDir()
    writeFileSync(
      join(projectDir, '.claude', 'settings.json'),
      JSON.stringify({
        kairos: { skillLearning: { enabled: true, rateLimitMs: 3600000 } },
      }),
    )
    const cfg = readSkillLearningConfig(projectDir)
    expect(cfg.rateLimitMs).toBe(3600000)
  })
})
